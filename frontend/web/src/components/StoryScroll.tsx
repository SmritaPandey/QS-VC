import Portrait from './Portrait';
import '../styles/meeting-story.css';
interface Caption { text: string; language: string; label: string; announce?: boolean }
interface Props { caption: Caption }
const features = [
    { id: 'story-prepare', title: 'Join with confidence.', body: 'Get ready before entering the room. Preview how you’ll look and sound, whether you’re joining from your desk or listening on the move.', points: ['Check your camera and microphone before joining.', 'Choose a display name for the room.'] },
    { id: 'story-meet', title: 'Keep people and shared work in view.', body: 'Keep people and presentations together. Switch between Gallery, Focus, Sidebar and Filmstrip to arrange your screen as the conversation moves between shared work and discussion.', points: ['Present a document alongside the conversation.', 'Use chat to share a written thought.'] },
    { id: 'story-discuss', title: 'One conversation, different ways to follow.', body: 'Speakers choose whether to share speech as captions. Listeners choose captions and available translated audio independently, with different languages for each if they prefer.', points: ['Open Language for your meeting’s available languages and device voices.', 'Use headphones for translated audio.'] },
    { id: 'story-host', title: 'Make time for the conversation.', body: 'Schedule a meeting and share the invitation. Hosts can manage the waiting room, lock entry and control participant chat and screen sharing.', points: ['Raise a hand without speaking over someone.', 'Manage your own microphone and camera.'] },
];
function Person({ person, name }: { person: 0 | 1 | 2; name: string }) { return <div className="feature-person"><Portrait person={person} label={`Illustrative participant ${name}`} /><span>{name}</span></div>; }
function UprightFeatureVisual({ kind, caption }: { kind: number; caption: Caption }) {
    return <figure className={`feature-visual feature-visual--${kind}`} aria-label={['Meeting preview', 'Presentation with participants', 'Written caption sample', 'Meeting participants'][kind]}>
        {kind === 0 && <div className="feature-preview"><Person person={0} name="Aditi" /><dl className="feature-device-list"><div><dt>Your name</dt><dd>Aditi</dd></div><div><dt>Camera</dt><dd><span className="mi" aria-hidden="true">videocam</span> Preview</dd></div><div><dt>Microphone</dt><dd><span className="mi" aria-hidden="true">mic</span> Check</dd></div></dl></div>}
        {kind === 1 && <div className="feature-presentation"><div className="feature-paper"><h4>The proposal</h4><p>Scope and objectives</p><p>Open questions</p><p>Agreed next steps</p></div><div className="feature-side-people"><Person person={1} name="Arjun" /><Person person={2} name="Mei" /></div><div className="feature-chat-note"><span className="mi" aria-hidden="true">chat_bubble</span> Let’s discuss the next steps.</div></div>}
        {kind === 2 && <div className="feature-language"><div className="feature-language-people"><Person person={0} name="Aditi" /><Person person={2} name="Mei" /></div><div className="feature-written-caption" aria-live="off" aria-atomic="true"><span>{caption.label}</span><p key={caption.language} lang={caption.language}>{caption.text}</p></div></div>}
        {kind === 3 && <div className="feature-participants"><div className="feature-participant-heading">In the conversation</div><div><Person person={0} name="Aditi" /><span>Camera on</span></div><div><Person person={1} name="Arjun" /><span className="feature-hand"><span className="mi" aria-hidden="true">front_hand</span> Hand raised</span></div><div><Person person={2} name="Mei" /><span className="mi" aria-label="Microphone muted">mic_off</span></div><p>Chat gives everyone another way to contribute.</p></div>}
    </figure>;
}
export default function StoryScroll({ caption }: Props) {
    return <section className="meeting-features" aria-label="Ways to meet with QS-VC">{features.map((feature, index) => <article className="meeting-feature home-arrival" id={feature.id} key={feature.id}>
        <div className="meeting-feature-copy">{index === 2 && <span id="languages" className="feature-anchor" />}<h2>{feature.title}</h2><p>{feature.body}</p><ul>{feature.points.map(point => <li key={point}>{point}</li>)}</ul>{index === 3 && <a className="feature-schedule-link" href="/schedule">Schedule a meeting <span className="mi" aria-hidden="true">arrow_forward</span></a>}</div><UprightFeatureVisual kind={index} caption={caption} />
    </article>)}</section>;
}
