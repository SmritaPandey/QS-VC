import { describe, expect, it, vi } from 'vitest';
import { encryptedPollRpc } from './encrypted-polls.js';
import { roomManager, type PeerState } from './room-manager.js';
function setup() {
    const room=roomManager.getOrCreateRoom('poll-'+crypto.randomUUID());
    room.settings.e2eeRequired=true;
    const sockets=new Map(['host','a','b'].map(id=>[id,{readyState:1,send:vi.fn()}]));
    for(const [id,ws] of sockets) room.peers.set(id,{id,ws,role:id==='host'?'host':'member',displayName:id,e2eeKeyBundle:{peerId:id,kemPublicKey:'kem',signingPublicKey:'key-'+id,signature:'signature'}} as unknown as PeerState);
    const rpc=(id:string,method:string,params:unknown={})=>encryptedPollRpc(sockets.get(id),room.id,id,method,params) as any;
    const id=crypto.randomUUID();
    const encrypted={version:1,room:room.id,senderPeerId:'host',fileId:id,revision:1,noteVersion:1,epoch:Buffer.alloc(32,1).toString('base64'),nonce:Buffer.alloc(12,2).toString('base64'),ciphertext:Buffer.alloc(32,3).toString('base64'),signature:Buffer.alloc(4627,4).toString('base64')};
    const ballot=(senderPeerId:string,revision=1)=>({pollId:id,revision,senderPeerId,targetPeerId:'host',capsule:Buffer.alloc(1568,1).toString('base64'),nonce:encrypted.nonce,ciphertext:encrypted.ciphertext,signature:encrypted.signature});
    return {room,sockets,rpc,id,encrypted,ballot};
}
describe('encrypted polls',()=>{
    it('stores sealed polls and moderator-only ballots for two attendees, rejects replay and closed votes',()=>{
        const {rpc,id,encrypted,ballot}=setup();
        expect(()=>rpc('a','createEncryptedPoll',{id,encrypted,results:'hosts'})).toThrow('Moderator');
        rpc('host','createEncryptedPoll',{id,encrypted,results:'hosts'});
        rpc('a','voteEncryptedPoll',{id,copies:[ballot('a')]});
        rpc('b','voteEncryptedPoll',{id,copies:[ballot('b')]});
        expect(rpc('a','getEncryptedPoll',{id})).toMatchObject({total:2,myRevision:1,results:'hosts'});
        expect(()=>rpc('a','getEncryptedBallots',{id})).toThrow('Moderator');
        expect(()=>rpc('a','voteEncryptedPoll',{id,copies:[ballot('a')]})).toThrow('revision');
        expect(rpc('host','getEncryptedBallots',{id})).toMatchObject({records:[{encrypted:ballot('a')}],nextCursor:1});
        expect(()=>rpc('host','publishEncryptedPoll',{id,encrypted})).toThrow('restricted');
        rpc('host','closeEncryptedPoll',{id});
        expect(()=>rpc('b','voteEncryptedPoll',{id,copies:[ballot('b',2)]})).toThrow('closed');
    });
    it('invalidates published totals when a voter changes choice without changing participation count',()=>{
        const {rpc,id,encrypted,ballot}=setup();
        rpc('host','createEncryptedPoll',{id,encrypted,results:'live'});
        rpc('a','voteEncryptedPoll',{id,copies:[ballot('a')]});
        rpc('host','publishEncryptedPoll',{id,encrypted,ballotRevision:1});
        expect(rpc('b','getEncryptedPollResults',{id})).not.toBeNull();
        rpc('a','voteEncryptedPoll',{id,copies:[ballot('a',2)]});
        expect(rpc('b','getEncryptedPoll',{id})).toMatchObject({total:1,ballotRevision:2});
        expect(rpc('b','getEncryptedPollResults',{id})).toBeNull();
        expect(()=>rpc('host','publishEncryptedPoll',{id,encrypted,ballotRevision:1})).toThrow('Ballots changed');
    });
    it('enforces room, current moderator recipients and result publication policy',()=>{
        const {rpc,room,id,encrypted,ballot}=setup();
        expect(()=>rpc('host','createEncryptedPoll',{id,encrypted:{...encrypted,room:'other'},results:'live'})).toThrow('room');
        rpc('host','createEncryptedPoll',{id,encrypted,results:'afterClose'});
        expect(()=>rpc('a','voteEncryptedPoll',{id,copies:[{...ballot('a'),targetPeerId:'b'}]})).toThrow('recipient');
        expect(()=>rpc('a','voteEncryptedPoll',{id,copies:[ballot('b')]})).toThrow('recipient');
        expect(()=>rpc('host','publishEncryptedPoll',{id,encrypted})).toThrow('restricted');
        rpc('host','closeEncryptedPoll',{id});
        rpc('host','publishEncryptedPoll',{id,encrypted,ballotRevision:0});
        expect(rpc('b','getEncryptedPollResults',{id})).toMatchObject({encrypted});
        room.peers.delete('b');
        expect(()=>rpc('b','getEncryptedPoll',{id})).toThrow('membership');
    });
});
