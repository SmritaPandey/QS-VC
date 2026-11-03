import Portrait from './Portrait';
import BrandLogo from './BrandLogo';
import '../styles/meeting-scene.css';
import '../styles/speaking-indicator.css';
interface Props { variant?: 'hero'; upright?: boolean; caption?: { text: string; language: string; label: string; announce?: boolean } }
export default function MeetingScene({ caption = { text: 'Can everyone see the proposal?', language: 'en', label: 'English' } }: Props) {
    return <div className="meeting-scene" aria-label="Meeting preview">
        <div className="meeting-scene-top"><BrandLogo meeting /><span><span className="mi" aria-hidden="true">group</span> 3</span></div>
        <div className="meeting-scene-stage">
        <div className="meeting-scene-participants">
            <div className="meeting-scene-person meeting-scene-main"><Portrait person={0} label="Aditi" /><span className="meeting-scene-name"><span className="qsvc-speaking qsvc-speaking--sample" aria-hidden="true"><i /><i /><i /></span>Aditi</span></div>
            <div className="meeting-scene-person"><Portrait person={1} label="Arjun" /><span className="meeting-scene-name"><span className="mi meeting-scene-muted" aria-hidden="true">mic_off</span>Arjun</span></div>
            <div className="meeting-scene-person"><Portrait person={2} label="Mei" /><span className="meeting-scene-name"><span className="mi meeting-scene-muted" aria-hidden="true">mic_off</span>Mei</span></div>
        </div>
        <div className="meeting-scene-side" aria-hidden="true"><span className="meeting-scene-control"><span className="mi">mic</span></span><span className="meeting-scene-control"><span className="mi">videocam</span></span><span className="meeting-scene-control meeting-scene-language"><span className="mi">translate</span></span></div>
        </div>
        <div className="meeting-scene-caption" aria-live={caption.announce ? 'polite' : 'off'} aria-atomic="true"><span>{caption.label}</span><p key={caption.language} lang={caption.language}>{caption.text}</p></div>
        <div className="meeting-scene-bottom" aria-hidden="true"><div className="meeting-scene-dock">{['screen_share', 'back_hand', 'add_reaction', 'group', 'chat', 'more_horiz'].map(icon => <span className="meeting-scene-control" key={icon}><span className="mi">{icon}</span></span>)}<span className="meeting-scene-control meeting-scene-leave"><span className="mi">call_end</span></span></div></div>
    </div>;
}
