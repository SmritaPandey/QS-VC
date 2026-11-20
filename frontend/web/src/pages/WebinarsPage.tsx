import SelectionInput from '../components/SelectionInput';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SiteNav from '../components/SiteNav';
import SiteFooter from '../components/SiteFooter';
import { getToken } from '../lib/session';
import { useSession } from '../lib/use-session';
import '../styles/webinars.css';

const base = (import.meta.env.VITE_API_URL || import.meta.env.VITE_MEETING_URL || '').replace(/\/+$/, '');
export const WEBINAR_API = `${base.endsWith('/api/meetings') ? base : `${base}/api/meetings`}/webinars`;
export type WebinarField = { id: string; label: string; type: 'text' | 'email' | 'tel' | 'select'; required: boolean; options?: string[] };
export type WebinarData = { id?: string; publicId?: string; meetingId: string; meetingCode?: string; title: string; description: string;
    registrationLimit: number; published: boolean; customFields: WebinarField[];
    branding: { logoUrl: string; backgroundUrl: string; introVideoUrl: string; accent: string };
    speakers: Array<{ name: string; role: 'speaker' | 'moderator'; userId?: string }>; scheduledStart?: string; scheduledEnd?: string;
    registrationOffset?: number; nextOffset?: number | null;
    registrations?: Array<{ id: string; name: string; email: string; answers: Record<string,string>; status: string; createdAt: string }> };
export const emptyWebinar: WebinarData = { meetingId: '', title: '', description: '', registrationLimit: 100, published: false, customFields: [],
    branding: { logoUrl: '', backgroundUrl: '', introVideoUrl: '', accent: '#006d77' }, speakers: [] };
export async function webinarRequest(path: string, init: RequestInit = {}) {
    const token = getToken();
    const response = await fetch(WEBINAR_API + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || (response.status === 403 ? 'Your account does not have access to this webinar.' : 'This request could not be completed. Try again.'));
    return body;
}
export function WebinarLayout({ children }: { children: ReactNode }) { return <div className="public-site"><SiteNav/><main className="webinars-page">{children}</main><SiteFooter/></div>; }
export function WebinarPresentation({ data, children }: { data: WebinarData; children: ReactNode }) {
    return <article className="webinar-presentation" style={{ borderTopColor: data.branding.accent }}>
        {data.branding.backgroundUrl && <img className="webinar-banner" src={data.branding.backgroundUrl} alt="" referrerPolicy="no-referrer"/>}
        <div className="webinar-presentation-body">
            {data.branding.logoUrl && <img className="webinar-brand" src={data.branding.logoUrl} alt="Organizer logo" referrerPolicy="no-referrer"/>}
            <p className="webinar-eyebrow">QS-VC webinar</p><h1>{data.title}</h1>
            {data.scheduledStart && <p><time dateTime={data.scheduledStart}>{new Date(data.scheduledStart).toLocaleString()}</time></p>}
            <p className="webinar-description">{data.description}</p>
            {!!data.speakers.length && <section aria-label="Webinar speakers"><h2>Speakers and moderators</h2><ul>{data.speakers.map((speaker,index) => <li key={index}>{speaker.name} · {speaker.role}</li>)}</ul></section>}
            {data.branding.introVideoUrl && <video className="webinar-intro" controls preload="none" src={data.branding.introVideoUrl}>Your browser cannot play this introduction.</video>}
            {children}
        </div>
    </article>;
}
export function WebinarFields({ fields, answers, onChange, disabled = false }: { fields: WebinarField[]; answers: Record<string,string>; onChange: (id:string,value:string)=>void; disabled?: boolean }) {
    return <>{fields.map(field => <label key={field.id}>{field.label}{field.required ? ' *' : ' (optional)'}
        {field.type === 'select' ? <select required={field.required} disabled={disabled} value={answers[field.id] || ''} onChange={event => onChange(field.id,event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
            : <input type={field.type} required={field.required} disabled={disabled} maxLength={1000} value={answers[field.id] || ''} onChange={event => onChange(field.id,event.target.value)}/>}
    </label>)}</>;
}
export default function WebinarsPage() {
    const session = useSession();
    const [webinars,setWebinars] = useState<WebinarData[]>([]); const [meetings,setMeetings] = useState<Array<{id:string;title:string;scheduledStart:string | null}>>([]);
    const [form,setForm] = useState<WebinarData>({...emptyWebinar}); const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true);
    const [rosterLoading,setRosterLoading] = useState(false);
    const [notice,setNotice] = useState(''); const [error,setError] = useState('');
    async function load() {
        setLoading(true);
        try { const [list,owned] = await Promise.all([webinarRequest('/'),webinarRequest('/owned-meetings')]); setWebinars(list.webinars);setMeetings(owned.meetings); }
        catch(cause) { setError((cause as Error).message); } finally { setLoading(false); }
    }
    useEffect(() => { if (session.status === 'authenticated') void load(); else if (session.status !== 'checking') setLoading(false); },[session.status,session.profile?.id]);
    async function edit(id: string, offset = 0) { setError('');setRosterLoading(true); try { setForm(await webinarRequest(`/${id}?limit=100&offset=${offset}`)); } catch(cause) { setError((cause as Error).message); } finally { setRosterLoading(false); } }
    async function save(event: FormEvent) {
        event.preventDefault(); if(busy)return;setBusy(true);setError('');setNotice('');
        try { const saved = await webinarRequest(form.id ? `/${form.id}` : '/', { method: form.id ? 'PATCH' : 'POST',body:JSON.stringify(form) }); await edit(saved.id, saved.id === form.id ? form.registrationOffset || 0 : 0);await load();setNotice('Webinar saved. Registration approval remains separate from meeting admission.'); }
        catch(cause) { setError((cause as Error).message); }finally { setBusy(false); }
    }
    async function review(id:string,status:string) { if(!form.id || busy)return;setBusy(true);setError('');try { await webinarRequest(`/${form.id}/registrations/${id}`,{method:'PATCH',body:JSON.stringify({status})});await edit(form.id, form.registrationOffset || 0); }catch(cause){setError((cause as Error).message);}finally{setBusy(false);} }
    function update<K extends keyof WebinarData>(key:K,value:WebinarData[K]) { setForm(previous=>({...previous,[key]:value})); }
    if(session.status !== 'authenticated')return <WebinarLayout><h1>Webinars</h1><p>{loading?'Checking your account…':'Sign in to organize webinars and review registrations.'}</p><Link to="/login">Sign in</Link></WebinarLayout>;
    return <WebinarLayout><header className="webinar-page-header"><div><p className="webinar-eyebrow">Organizer workspace</p><h1>Webinars</h1><p>Prepare registration, review attendees and preview your event page.</p></div><Link to="/app">Create a webinar meeting link</Link></header>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{loading && <p role="status">Loading webinars…</p>}
        <div className="webinar-workspace"><aside aria-label="Your webinars"><button type="button" disabled={busy||rosterLoading} onClick={()=>setForm({...emptyWebinar,customFields:[],speakers:[]})}>New webinar</button>{!loading&&!webinars.length&&<p>No webinars yet.</p>}<ul>{webinars.map(webinar=><li key={webinar.id}><button type="button" disabled={busy||rosterLoading} onClick={()=>void edit(webinar.id!)} aria-pressed={form.id===webinar.id}>{webinar.title}<small>{webinar.published?'Registration open':'Draft'}</small></button></li>)}</ul></aside>
        <div><form className="webinar-form" onSubmit={event=>void save(event)}><h2>{form.id?'Edit webinar':'Create webinar'}</h2><fieldset disabled={busy||rosterLoading}><legend className="sr-only">Webinar details</legend>
            <label>Webinar meeting link<select required value={form.meetingId} disabled={!!form.id} onChange={event=>update('meetingId',event.target.value)}><option value="">Choose a webinar link</option>{meetings.map(meeting=><option value={meeting.id} key={meeting.id}>{meeting.title}{meeting.scheduledStart ? ` · ${new Date(meeting.scheduledStart).toLocaleDateString()}` : ''}</option>)}</select></label>
            {!meetings.length&&!loading&&<p>From Meetings, choose New meeting → Create a link → Webinar, then come back to set up registration.</p>}
            <label>Webinar title<input required maxLength={200} value={form.title} onChange={event=>update('title',event.target.value)}/></label>
            <label>About the webinar<textarea maxLength={4000} rows={4} value={form.description} onChange={event=>update('description',event.target.value)}/></label>
            <label>Registration limit<input required type="number" min={1} max={30000} value={form.registrationLimit} onChange={event=>update('registrationLimit',Number(event.target.value))}/></label><p className="webinar-help">This limits registrations. Live meeting capacity depends on your service and plan.</p>
            <label className="webinar-checkbox"><SelectionInput type="checkbox" checked={form.published} onChange={event=>update('published',event.target.checked)}/>Open the registration page</label>
            <h3>Registration form</h3><p>Name and email are included. Add up to eight extra fields.</p>
            {form.customFields.map((field,index)=><div className="webinar-field-editor" key={field.id}><label>Field label<input required maxLength={100} value={field.label} onChange={event=>update('customFields',form.customFields.map((item,i)=>i===index?{...item,label:event.target.value}:item))}/></label><label>Type<select value={field.type} onChange={event=>update('customFields',form.customFields.map((item,i)=>i===index?{...item,type:event.target.value as WebinarField['type']}:item))}>{['text','email','tel','select'].map(type=><option key={type}>{type}</option>)}</select></label>{field.type==='select'&&<label>Options, one per line<textarea required value={field.options?.join('\n')||''} onChange={event=>update('customFields',form.customFields.map((item,i)=>i===index?{...item,options:event.target.value.split('\n').slice(0,10)}:item))}/></label>}<label className="webinar-checkbox"><SelectionInput type="checkbox" checked={field.required} onChange={event=>update('customFields',form.customFields.map((item,i)=>i===index?{...item,required:event.target.checked}:item))}/>Required</label><button type="button" onClick={()=>update('customFields',form.customFields.filter((_,i)=>i!==index))}>Remove field</button></div>)}
            <button type="button" disabled={form.customFields.length>=8} onClick={()=>update('customFields',[...form.customFields,{id:`field_${Date.now()}`,label:'',type:'text',required:false}])}>Add registration field</button>
            <h3>Branding</h3><p className="webinar-help">Use HTTPS media URLs. Media is loaded directly by each visitor’s browser.</p>
            {(['logoUrl','backgroundUrl','introVideoUrl'] as const).map(key=><label key={key}>{key==='logoUrl'?'Logo URL':key==='backgroundUrl'?'Banner image URL':'Introduction video URL'}<input type="url" placeholder="https://" maxLength={2048} value={form.branding[key]} onChange={event=>update('branding',{...form.branding,[key]:event.target.value})}/></label>)}
            <label>Accent colour<input type="color" value={form.branding.accent} onChange={event=>update('branding',{...form.branding,accent:event.target.value})}/></label>
            <h3>Event programme</h3><p className="webinar-help">Programme labels do not grant meeting permissions. Invite and manage presenters inside the linked meeting.</p>
            {form.speakers.map((speaker,index)=><div className="webinar-field-editor" key={index}><label>Name<input required maxLength={100} value={speaker.name} onChange={event=>update('speakers',form.speakers.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>Programme role<select value={speaker.role} onChange={event=>update('speakers',form.speakers.map((item,i)=>i===index?{...item,role:event.target.value as 'speaker'|'moderator'}:item))}><option value="speaker">Speaker</option><option value="moderator">Moderator</option></select></label><button type="button" onClick={()=>update('speakers',form.speakers.filter((_,i)=>i!==index))}>Remove person</button></div>)}
            <button type="button" disabled={form.speakers.length>=20} onClick={()=>update('speakers',[...form.speakers,{name:'',role:'speaker'}])}>Add speaker or moderator</button>
            <div className="webinar-actions"><button className="btn-primary" type="submit">{busy?'Saving…':'Save webinar'}</button>{form.id&&<Link to={`/webinars/${form.id}/preview`}>Preview registration page</Link>}{form.publicId&&form.published&&<Link to={`/webinars/register/${form.publicId}`}>Open registration page</Link>}</div>
        </fieldset></form>
        {form.id&&<section className="webinar-roster"><h2>Registrations</h2><p>Approval provides attendee access. Participants still follow the meeting’s admission settings.</p><button type="button" disabled={busy||rosterLoading} onClick={()=>void edit(form.id!,form.registrationOffset || 0)}>Refresh registrations</button>{rosterLoading&&<p role="status">Loading registrations…</p>}{!form.registrations?.length?<p>No registrations yet.</p>:<div className="webinar-table-wrap"><table><thead><tr><th>Name and email</th><th>Answers</th><th>Status</th><th>Review</th></tr></thead><tbody>{form.registrations.map(registration=><tr key={registration.id}><td>{registration.name}<small>{registration.email}</small></td><td>{Object.entries(registration.answers).map(([key,value])=><p key={key}>{form.customFields.find(field=>field.id===key)?.label||key}: {value}</p>)}</td><td>{registration.status}</td><td><button type="button" disabled={busy||rosterLoading||registration.status==='approved'} onClick={()=>void review(registration.id,'approved')}>Approve</button><button type="button" disabled={busy||rosterLoading||registration.status==='rejected'} onClick={()=>void review(registration.id,'rejected')}>Reject</button></td></tr>)}</tbody></table></div>}<nav aria-label="Registration pages"><button type="button" disabled={busy||rosterLoading||!form.registrationOffset} onClick={()=>void edit(form.id!,Math.max(0,(form.registrationOffset || 0)-100))}>Previous</button><span role="status">Page {Math.floor((form.registrationOffset || 0)/100)+1}</span><button type="button" disabled={busy||rosterLoading||form.nextOffset==null} onClick={()=>void edit(form.id!,form.nextOffset!)}>Next</button></nav></section>}
        </div></div>
    </WebinarLayout>;
}
