const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const logoBase64 = fs.readFileSync(path.resolve('qsvc_logo.png')).toString('base64');
const logoData = `image/png;base64,${logoBase64}`;

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'QS-VC Technologies';
pptx.title = 'QS-VC — Quantum-Safe Video Conferencing';

const BG='0A1628', ACC='00BCD4', ACC2='1565C0', W='FFFFFF', M='8FA4C0', CD='0F1F3A';

function bg(s){s.background={color:BG}}
function logo(s){s.addImage({data:logoData,x:0.4,y:0.25,w:0.45,h:0.45,rounding:true});s.addText('QS-VC',{x:0.95,y:0.3,fontSize:14,bold:true,color:ACC,fontFace:'Segoe UI'})}
function sn(s,n,t){s.addText(n+' / '+t,{x:11.5,y:7.0,fontSize:10,color:M,fontFace:'Segoe UI'})}
function div(s){s.addShape(pptx.ShapeType.rect,{x:0.4,y:0.95,w:0.6,h:0.04,fill:{color:ACC}})}
function card(s,x,y,w,h,title,items,bc){
  s.addShape(pptx.ShapeType.roundRect,{x,y,w,h,rectRadius:0.1,fill:{color:CD},line:{color:bc||'1A3A5C',width:bc?2:1}});
  if(title)s.addText(title,{x:x+0.15,y:y+0.1,w:w-0.3,fontSize:13,bold:true,color:W,fontFace:'Segoe UI'});
  if(items&&items.length){const t=items.map(txt=>({text:txt,options:{bullet:true,fontSize:11,color:M,fontFace:'Segoe UI',paraSpaceBefore:2}}));s.addText(t,{x:x+0.15,y:y+(title?0.45:0.1),w:w-0.3,h:h-(title?0.55:0.2),valign:'top'})}
}
function step(s,x,y,t,d){
  s.addShape(pptx.ShapeType.roundRect,{x,y,w:2.2,h:1.3,rectRadius:0.08,fill:{color:CD},line:{color:'1A3A5C',width:1}});
  s.addText(t,{x,y:y+0.15,w:2.2,fontSize:12,bold:true,color:W,align:'center',fontFace:'Segoe UI'});
  s.addText(d,{x,y:y+0.5,w:2.2,fontSize:9,color:M,align:'center',fontFace:'Segoe UI'})
}
function arrow(s,x,y){s.addText('→',{x,y,w:0.4,fontSize:16,bold:true,color:ACC,fontFace:'Segoe UI',align:'center'})}
function badge(s,x,y,text,w){w=w||1.5;s.addShape(pptx.ShapeType.roundRect,{x,y,w,h:0.32,rectRadius:0.05,fill:{color:CD},line:{color:'1A3A5C',width:1}});s.addText(text,{x,y,w,h:0.32,fontSize:8,bold:true,color:ACC,fontFace:'Segoe UI',align:'center'})}

const T=8;

// SLIDE 1: TITLE
{const s=pptx.addSlide();bg(s);sn(s,1,T);
s.addImage({data:logoData,x:5.9,y:0.6,w:1.1,h:1.1,rounding:true});
s.addText([{text:'Quantum-Safe\n',options:{fontSize:44,bold:true,color:W}},{text:'Video Conferencing',options:{fontSize:44,bold:true,color:ACC}}],{x:1.5,y:2.0,w:10,h:2,align:'center',fontFace:'Segoe UI'});
s.addText('Secure HD/4K video calls with NIST-approved post-quantum\ncryptography, real-time AI captions & translation.',{x:2,y:4.0,w:9,h:0.8,align:'center',fontSize:14,color:M,fontFace:'Segoe UI'});
[['PQC L5','NIST Security Level'],['10K+','Participants/Call'],['99+','Languages STT'],['99.995%','Uptime SLA']].forEach(([v,l],i)=>{const sx=2.2+i*2.4;s.addText(v,{x:sx,y:5.1,w:2,fontSize:26,bold:true,color:ACC,fontFace:'Segoe UI',align:'center'});s.addText(l,{x:sx,y:5.7,w:2,fontSize:9,color:M,fontFace:'Segoe UI',align:'center'})});
['E2E Encrypted','Zero-Knowledge SFU','AI Captions','Air-Gap Ready','HSM Keys'].forEach((b,i)=>badge(s,1.5+i*2.2,6.3,b,2.0))}

// SLIDE 2: QUANTUM THREAT
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,2,T);
s.addText('The Quantum Threat to Video Calls',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
s.addText('Adversaries harvest encrypted call traffic today, waiting for quantum computers to break it.',{x:0.4,y:1.85,w:9,fontSize:13,color:M,fontFace:'Segoe UI'});
card(s,0.4,2.6,5.8,3.8,"The Risk",['RSA-2048 & ECC vulnerable to Shor\'s algorithm','Quantum computers expected by 2030','Nation-states harvesting encrypted call traffic','Video calls contain the most sensitive discussions','Once broken, all recorded calls exposed forever'],'EF5350');
card(s,6.6,2.6,6.2,3.8,'QS-VC Solution',['Hybrid Kyber-1024 + X25519 for every call','Dilithium-5 + Ed25519 for all signaling','E2EE media — SFU never sees plaintext','Crypto-agility: dual-layer protection','60-second media key rotation'],ACC)}

// SLIDE 3: VC FEATURES
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,3,T);
s.addText('Video Conferencing Features',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
[['HD/4K Video','VP9/AV1, Simulcast+SVC, up to 4K@30fps'],['Crystal Audio','Opus 48kHz stereo, AI noise suppression'],['Screen Sharing','Full-screen, annotation, remote control'],['Whiteboard','CRDT collaborative canvas, real-time sync'],['Recording','Cloud/on-prem, MP4, encrypted at rest'],['Live Streaming','RTMP→HLS/DASH, 100K+ broadcast']].forEach(([t,d],i)=>{const c=i%3,r=Math.floor(i/3),fx=0.4+c*4.2,fy=2.1+r*2.3;card(s,fx,fy,3.9,2.0,t);s.addText(d,{x:fx+0.15,y:fy+0.5,w:3.6,fontSize:11,color:M,fontFace:'Segoe UI'})});
[['Smart Camera','Auto-framing, person tracking'],['Meeting Tools','Breakout rooms, polls, lobby'],['SIP/H.323 Interop','Legacy rooms, PSTN dial-in'],['Multi-Platform','Web, Desktop, iOS, Android']].forEach(([t,d],i)=>{const cx=0.4+i*3.15;s.addShape(pptx.ShapeType.roundRect,{x:cx,y:6.1,w:2.95,h:0.9,rectRadius:0.08,fill:{color:CD},line:{color:'1A3A5C',width:1}});s.addText(t,{x:cx+0.12,y:6.15,w:2.7,fontSize:11,bold:true,color:W,fontFace:'Segoe UI'});s.addText(d,{x:cx+0.12,y:6.42,w:2.7,fontSize:10,color:M,fontFace:'Segoe UI'})})}

// SLIDE 4: AI PIPELINE
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,4,T);
s.addText('AI-Powered Meeting Intelligence',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
s.addText('Real-Time Pipeline (<300ms)',{x:0.4,y:1.85,w:6,fontSize:14,bold:true,color:ACC,fontFace:'Segoe UI'});
[['Capture','Opus 48kHz'],['Denoise','RNNoise+U-Net'],['Transcribe','Whisper 99+ langs'],['Translate','NLLB-200'],['Display','Live captions']].forEach(([t,d],i)=>{step(s,0.4+i*2.5,2.3,t,d);if(i<4)arrow(s,2.55+i*2.5,2.65)});
s.addText('Post-Meeting AI (Async)',{x:0.4,y:3.9,w:6,fontSize:14,bold:true,color:ACC,fontFace:'Segoe UI'});
[['Clean','Speaker diarization'],['Segment','Topic identification'],['Summarize','LLaMA 3'],['Actions','Tasks+Deadlines'],['Report','Engagement']].forEach(([t,d],i)=>{step(s,0.4+i*2.5,4.3,t,d);if(i<4)arrow(s,2.55+i*2.5,4.65)});
[['Voice Cloning','Voice-preserving translation'],['22 Indian Langs','All scheduled languages'],['Smart Search','Search across transcripts']].forEach(([t,d],i)=>{const cx=0.4+i*4.2;s.addShape(pptx.ShapeType.roundRect,{x:cx,y:5.9,w:3.9,h:1.0,rectRadius:0.08,fill:{color:CD},line:{color:'1A3A5C',width:1}});s.addText(t,{x:cx+0.15,y:5.95,w:3.6,fontSize:12,bold:true,color:W,fontFace:'Segoe UI'});s.addText(d,{x:cx+0.15,y:6.3,w:3.6,fontSize:10,color:M,fontFace:'Segoe UI'})})}

// SLIDE 5: SECURITY
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,5,T);
s.addText('Quantum-Safe Security Architecture',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
s.addText('Every layer of the media pipeline is protected with PQC.',{x:0.4,y:1.85,w:9,fontSize:13,color:M,fontFace:'Segoe UI'});
[['Signaling (Quantum-TLS)','Kyber-1024+X25519, Dilithium-5+Ed25519, TLS 1.3+PQC'],['Media E2EE','SFrame via Insertable Streams, per-participant Kyber keys, AES-256-GCM'],['Key Management','HSM-backed (Shamir 5-of-8), 60s media key rotation, hourly TURN rotation'],['Recording Encryption','Kyber-wrapped DEK, encrypted MinIO/S3, tamper-proof metadata'],['Audit Trail','Merkle-tree hash chains, Dilithium-signed entries, configurable retention']].forEach(([t,d],i)=>{const ly=2.4+i*0.95;s.addShape(pptx.ShapeType.roundRect,{x:0.4,y:ly,w:12.4,h:0.8,rectRadius:0.08,fill:{color:CD},line:{color:'1A3A5C',width:1}});s.addShape(pptx.ShapeType.ellipse,{x:0.6,y:ly+0.14,w:0.48,h:0.48,fill:{color:ACC2}});s.addText(''+(i+1),{x:0.6,y:ly+0.14,w:0.48,h:0.48,fontSize:14,bold:true,color:W,fontFace:'Segoe UI',align:'center',valign:'middle'});s.addText(t,{x:1.3,y:ly+0.08,w:5,fontSize:13,bold:true,color:W,fontFace:'Segoe UI'});s.addText(d,{x:1.3,y:ly+0.38,w:11,fontSize:10.5,color:M,fontFace:'Segoe UI'})});
['NIST PQC Level 5','HSM-Backed','60s Key Rotation','Zero-Knowledge SFU'].forEach((b,i)=>badge(s,1.5+i*2.8,7.0,b,2.4))}

// SLIDE 6: DEPLOYMENT + SCALE
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,6,T);
s.addText('Deployment & Scalability',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
card(s,0.4,1.9,3.9,3.0,'SaaS Cloud',['Multi-tenant Kubernetes','Auto-scaling SFU pools','Region-selectable residency','Zero-downtime updates']);
card(s,4.6,1.9,3.9,3.0,'On-Premise (Air-Gapped)',['100% on-site, zero internet','HSM key management','Local AI (NVIDIA A10)','4-8 hour automated install'],ACC);
card(s,8.8,1.9,3.9,3.0,'Hybrid',['Edge media+cloud control','Media stays local','72hr offline grace','Auto state sync']);
[['99.995%','Platform SLA'],['<3s','Join Time'],['<150ms','Audio Latency'],['<2s','Failover']].forEach(([v,l],i)=>{const sx=1.5+i*2.8;s.addText(v,{x:sx,y:5.2,w:2.4,fontSize:22,bold:true,color:ACC,fontFace:'Segoe UI',align:'center'});s.addText(l,{x:sx,y:5.7,w:2.4,fontSize:9,color:M,fontFace:'Segoe UI',align:'center'})});
['1-49: Single SFU','50-500: SFU Cascade','500-10K: Webinar','10K-100K: Broadcast'].forEach((b,i)=>badge(s,1.0+i*2.9,6.3,b,2.7))}

// SLIDE 7: PRICING
{const s=pptx.addSlide();bg(s);logo(s);div(s);sn(s,7,T);
s.addText('Choose Your Plan',{x:0.4,y:1.15,w:10,fontSize:30,bold:true,color:W,fontFace:'Segoe UI'});
[['Business','SaaS | Per-user/month',['Up to 300 participants','HD 1080p video & audio','Screen sharing & recording','AI captions (English)','Basic noise suppression','SSO (SAML 2.0 / OIDC)','Email support']],
['Enterprise','SaaS/Hybrid | Custom',['Up to 10,000 participants','4K video + live streaming','99+ language STT & translation','Quantum-safe E2EE (PQC)','Summarization & actions','SIP/H.323 gateway','24/7 support + CSM']],
['Sovereign','On-Premise | Perpetual+AMC',['Air-gapped deployment','HSM key management','All AI (local GPU)','Full data sovereignty','Custom branding','LDAP/Active Directory','On-site deployment']]
].forEach(([t,sub,items],i)=>{const px=0.4+i*4.2,f=i===1;s.addShape(pptx.ShapeType.roundRect,{x:px,y:2.2,w:3.9,h:4.6,rectRadius:0.1,fill:{color:CD},line:{color:f?ACC:'1A3A5C',width:f?2:1}});s.addText(t,{x:px,y:2.3,w:3.9,fontSize:17,bold:true,color:W,fontFace:'Segoe UI',align:'center'});s.addText(sub,{x:px,y:2.7,w:3.9,fontSize:10,bold:true,color:ACC,fontFace:'Segoe UI',align:'center'});const bullets=items.map(txt=>({text:txt,options:{bullet:true,fontSize:10.5,color:M,fontFace:'Segoe UI',paraSpaceBefore:3}}));s.addText(bullets,{x:px+0.3,y:3.2,w:3.3,h:3.4,valign:'top'})})}

// SLIDE 8: CTA
{const s=pptx.addSlide();bg(s);logo(s);sn(s,8,T);
s.addImage({data:logoData,x:5.9,y:1.2,w:0.9,h:0.9,rounding:true});
s.addText([{text:'Secure Calls Today.\n',options:{fontSize:38,bold:true,color:W}},{text:'Quantum-Safe Tomorrow.',options:{fontSize:38,bold:true,color:ACC}}],{x:2,y:2.3,w:9,h:1.5,align:'center',fontFace:'Segoe UI'});
s.addText('Schedule a demo and experience quantum-safe video\nconferencing — HD/4K with post-quantum encryption.',{x:2.5,y:3.9,w:8,fontSize:13,color:M,fontFace:'Segoe UI',align:'center'});
s.addShape(pptx.ShapeType.roundRect,{x:3.5,y:4.9,w:6,h:1.8,rectRadius:0.15,fill:{color:CD},line:{color:'1A3A5C',width:1}});
s.addText('Get Started',{x:3.5,y:5.0,w:6,fontSize:18,bold:true,color:W,fontFace:'Segoe UI',align:'center'});
['www.qsvc.io','sales@qsvc.io','+91-XXXX-XXXXXX','Bengaluru, India'].forEach((c,i)=>s.addText(c,{x:3.5,y:5.45+i*0.28,w:6,fontSize:12,color:ACC,fontFace:'Segoe UI',align:'center'}));
s.addText('© 2025 QS-VC Technologies Pvt. Ltd. — All Rights Reserved',{x:2,y:7.0,w:9,fontSize:9,color:M,fontFace:'Segoe UI',align:'center'})}

pptx.writeFile({fileName:path.resolve('QS-VC_Presentation.pptx')}).then(()=>console.log('✓ QS-VC_Presentation.pptx created!')).catch(e=>{console.error('Error:',e.message);process.exit(1)});
