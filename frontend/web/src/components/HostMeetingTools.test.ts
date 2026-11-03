import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../lib/signaling', () => ({ signaling: { request: vi.fn(), on: vi.fn() } }));
import HostMeetingTools, { canManagePeer } from './HostMeetingTools';
import { WaitingAdmission } from './WaitingRoom';
describe('host tools boundaries', () => {
 it('does not expose host actions to members or allow co-hosts to manage hosts', () => {
  expect(canManagePeer('member','self',{peerId:'other',displayName:'Other',role:'member'})).toBe(false);
  expect(canManagePeer('co-host','self',{peerId:'other',displayName:'Host',role:'host'})).toBe(false);
  expect(canManagePeer('host','self',{peerId:'self',displayName:'Self',role:'host'})).toBe(false);
  expect(canManagePeer('host','self',{peerId:'other',displayName:'Member',role:'member'})).toBe(true);
  expect(renderToStaticMarkup(createElement(HostMeetingTools,{role:'member',myPeerId:'self',participants:[],settings:{locked:false,waitingRoomEnabled:false,muteOnEntry:false,allowScreenShare:true,allowChat:true},onClose:()=>{}}))).toBe('');
 });
 it('gives waiting attendees an exit and does not mount media controls', () => {
  const html=renderToStaticMarkup(createElement(WaitingAdmission,{meetingCode:'QS-TEST',onLeave:()=>{}}));
  expect(html).toContain('Leave waiting room'); expect(html).toContain('camera and microphone are off'); expect(html).not.toContain('<video');
 });
});
