import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { roomManager, type RoomState, type PeerState } from './room-manager.js';

interface Stroke { id:string; authorId:string; points:{x:number;y:number}[]; color:string; width:number }
/** live: everyone sees results as votes come in; afterClose: results shown when the host closes the poll; hosts: only hosts/co-hosts ever see results. */
type PollResults = 'live'|'afterClose'|'hosts';
interface Poll { id:string; question:string; options:string[]; votes:Record<string,number>; closed:boolean; results:PollResults; anonymous:boolean }
interface Question { id:string; text:string; authorId:string; authorName:string; voters:string[]; answer:string }
interface FileEntry { id:string; name:string; mime:string; size:number; authorId:string; authorName:string; data:string }
interface State { revision:number; strokes:Stroke[]; notes:{text:string;version:number}; polls:Poll[]; questions:Question[]; files:FileEntry[]; rates:Map<string,{at:number;count:number}> }
const states = new WeakMap<RoomState,State>();
const idSchema=z.string().uuid();
const text=(max:number)=>z.string().trim().min(1).max(max);
const schemas = z.discriminatedUnion('type',[
 z.object({type:z.literal('stroke:add'),points:z.array(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)})).min(2).max(1000),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),width:z.number().min(1).max(12)}),
 z.object({type:z.literal('stroke:undo'),id:idSchema}),z.object({type:z.literal('board:clear')}),
 z.object({type:z.literal('notes:update'),text:z.string().max(20000),version:z.number().int().nonnegative()}),
 z.object({type:z.literal('poll:create'),question:text(300),options:z.array(text(120)).min(2).max(6),results:z.enum(['live','afterClose','hosts']).default('live')}),
 z.object({type:z.literal('poll:vote'),id:idSchema,option:z.number().int().nonnegative()}),z.object({type:z.literal('poll:close'),id:idSchema}),
 z.object({type:z.literal('question:ask'),text:text(1000)}),z.object({type:z.literal('question:vote'),id:idSchema}),z.object({type:z.literal('question:answer'),id:idSchema,answer:text(2000)}),
 z.object({type:z.literal('file:add'),name:text(120).regex(/^[^/\\\x00-\x1f]+$/),mime:z.enum(['image/png','image/jpeg','text/plain','application/pdf']),data:z.string().max(43692).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}),
 z.object({type:z.literal('file:remove'),id:idSchema}),
]);
function fail(message:string):never { throw new Error(message); }
function context(ws:any,roomId:string,peerId:string) {
 const room=roomManager.getRoom(roomId); const peer=room?.peers.get(peerId);
 if(!room||!peer||peer.ws!==ws) fail('Not joined a room');
 let state=states.get(room);
 if(!state){state={revision:0,strokes:[],notes:{text:'',version:0},polls:[],questions:[],files:[],rates:new Map()};states.set(room,state);}
 return {room,peer,state};
}
const isManager=(peer?:PeerState)=>peer?.role==='host'||peer?.role==='co-host';
/** What one viewer may see of a poll: hidden results carry only the viewer's own vote and the total. */
function pollFor(poll:Poll,viewer?:PeerState){
 const visible=isManager(viewer)||poll.results==='live'||(poll.results==='afterClose'&&poll.closed);
 const total=Object.keys(poll.votes).length;
 if(visible)return {...poll,total,resultsHidden:false};
 const own=viewer&&viewer.id in poll.votes?{[viewer.id]:poll.votes[viewer.id]}:{};
 return {...poll,votes:own,total,resultsHidden:true};
}
function snapshot(state:State,viewer?:PeerState){return {revision:state.revision,strokes:state.strokes,notes:state.notes,polls:state.polls.map(poll=>pollFor(poll,viewer)),questions:state.questions,files:state.files.map(({data,...file})=>file)};}
function checkVoteCapacity(state:State){if(state.polls.reduce((n,p)=>n+Object.keys(p.votes).length,0)+state.questions.reduce((n,q)=>n+q.voters.length,0)>=1000)fail('Room vote limit reached');}
function host(peer:PeerState){if(peer.role!=='host'&&peer.role!=='co-host') fail('Host permission required');}
function own(peer:PeerState,authorId:string){if(peer.id!==authorId)host(peer);}
export function collaborationRpc(ws:any,roomId:string,peerId:string,method:string,params:unknown){
 const {room,peer,state}=context(ws,roomId,peerId);
 // Discard departed-peer throttle entries; state lives only as long as its room.
 for(const key of state.rates.keys())if(!room.peers.has(key))state.rates.delete(key);
 const now=Date.now();let rate=state.rates.get(peerId);
 if(!rate||now-rate.at>=1000){rate={at:now,count:0};state.rates.set(peerId,rate);}
 if(++rate.count>20)fail('Please slow down');
 if(method==='getCollaborationState')return snapshot(state,peer);
 if(method==='getCollaborationFile'){
  const {id}=z.object({id:idSchema}).parse(params); const file=state.files.find(f=>f.id===id);if(!file)fail('File not found');return {...file};
 }
 const action=schemas.parse(params);
 switch(action.type){
 case 'stroke:add':
  if(state.strokes.length>=500||state.strokes.reduce((n,s)=>n+s.points.length,0)+action.points.length>20000)fail('Whiteboard is full');
  state.strokes.push({id:randomUUID(),authorId:peerId,points:action.points,color:action.color,width:action.width});break;
 case 'stroke:undo':{const stroke=state.strokes.find(s=>s.id===action.id);if(!stroke)fail('Stroke not found');own(peer,stroke.authorId);state.strokes=state.strokes.filter(s=>s.id!==action.id);break;}
 case 'board:clear':host(peer);state.strokes=[];break;
 case 'notes:update':if(action.version!==state.notes.version)fail('Notes changed. Refresh before saving.');state.notes={text:action.text,version:state.notes.version+1};break;
 case 'poll:create':host(peer);if(state.polls.length>=20)fail('Poll limit reached');if(new Set(action.options).size!==action.options.length)fail('Use distinct poll options');state.polls.push({id:randomUUID(),question:action.question,options:action.options,votes:{},closed:false,results:action.results,anonymous:true});break;
 case 'poll:vote':{const poll=state.polls.find(p=>p.id===action.id);if(!poll||poll.closed||action.option>=poll.options.length)fail('Poll is unavailable');if(!(peerId in poll.votes))checkVoteCapacity(state);poll.votes[peerId]=action.option;break;}
 case 'poll:close':{host(peer);const poll=state.polls.find(p=>p.id===action.id);if(!poll)fail('Poll not found');poll.closed=true;break;}
 case 'question:ask':if(state.questions.length>=100)fail('Question limit reached');state.questions.push({id:randomUUID(),text:action.text,authorId:peerId,authorName:peer.displayName,voters:[],answer:''});break;
 case 'question:vote':{const q=state.questions.find(q=>q.id===action.id);if(!q)fail('Question not found');if(!q.voters.includes(peerId)){checkVoteCapacity(state);q.voters.push(peerId);}break;}
 case 'question:answer':{host(peer);const q=state.questions.find(q=>q.id===action.id);if(!q)fail('Question not found');q.answer=action.answer;break;}
 case 'file:add':{
  const extension = { 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'text/plain': /\.txt$/i, 'application/pdf': /\.pdf$/i }[action.mime];
  if(!extension.test(action.name))fail('Use a file extension matching its format');
  const data=Buffer.from(action.data,'base64');if(!data.length||data.length>32768||data.toString('base64')!==action.data)fail('Files must be 32 KB or smaller');
  const valid=action.mime==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):action.mime==='image/jpeg'?data[0]===255&&data[1]===216&&data[2]===255:action.mime==='application/pdf'?data.subarray(0,5).toString()==='%PDF-':!data.includes(0)&&Buffer.from(data.toString('utf8')).equals(data)&&!/<\s*(?:!doctype|html|script|svg|iframe)/i.test(data.toString('utf8'));
  if(!valid)fail('File content does not match an allowed format');
  if(state.files.length>=20||state.files.reduce((n,f)=>n+f.size,0)+data.length>524288)fail('Room file limit reached');
  state.files.push({id:randomUUID(),name:action.name,mime:action.mime,size:data.length,data:action.data,authorId:peerId,authorName:peer.displayName});break;
 }
 case 'file:remove':{const file=state.files.find(f=>f.id===action.id);if(!file)fail('File not found');own(peer,file.authorId);state.files=state.files.filter(f=>f.id!==action.id);break;}
 }
 state.revision++;
 // Each person gets their own view, so hidden poll results never reach participants.
 for(const viewer of room.peers.values()){
  if(viewer.id===peerId||viewer.ws?.readyState!==1)continue;
  roomManager.sendToSocket(viewer.ws,'collaborationUpdated',snapshot(state,viewer),viewer.id);
 }
 return snapshot(state,peer);
}
