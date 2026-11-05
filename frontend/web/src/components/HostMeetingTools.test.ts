import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../lib/signaling', () => ({ signaling: { request: vi.fn(), on: vi.fn() } }));
import HostMeetingTools, { canManagePeer } from './HostMeetingTools';
import WaitingRoom, { WaitingAdmission } from './WaitingRoom';
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
  expect(html).toContain('Leave waiting room'); expect(html).toContain('camera and microphone stay off'); expect(html).not.toContain('<video');
  const forHost=renderToStaticMarkup(createElement(WaitingAdmission,{meetingCode:'QS-TEST',onLeave:()=>{},mode:'host'}));
  expect(forHost).toContain('Waiting for the host'); expect(forHost).toContain('moved to the waiting room once the host arrives'); expect(forHost).not.toContain('<video');
  const seen=renderToStaticMarkup(createElement(WaitingAdmission,{meetingCode:'QS-TEST',onLeave:()=>{},mode:'seen'}));
  expect(seen).toContain('Your request has been seen'); expect(seen).toContain('A host or co-host has seen your request'); expect(seen).toContain('still in the waiting room');
 });
 it('keeps reviewed attendees in the same queue and retains separate admit and decline actions', () => {
  const html=renderToStaticMarkup(createElement(WaitingRoom,{
   isHost:true,busy:false,waitingPeers:[{peerId:'peer-1',displayName:'Ari',reviewed:true}],
   onAdmit:()=>{},onKeepWaiting:()=>{},onReject:()=>{},onAdmitAll:()=>{},
  }));
  expect(html).toContain('Still waiting · remains in this queue');
  expect(html).toContain('Admit to meeting'); expect(html).toContain('Decline');
  expect(html).toContain('Kept waiting'); expect(html).toContain('disabled="" aria-label="Ari is already kept waiting in this queue"');
 });
 it('shows the five co-host limit and disables further promotions', () => {
  const participants=[
   {peerId:'host',displayName:'Host',role:'host'},
   ...Array.from({length:5},(_,index)=>({peerId:`co-${index}`,displayName:`Co ${index}`,role:'co-host'})),
   {peerId:'member',displayName:'Member',role:'member'},
  ];
  const html=renderToStaticMarkup(createElement(HostMeetingTools,{
   role:'host',myPeerId:'host',participants,
   settings:{locked:false,waitingRoomEnabled:true,muteOnEntry:false,allowScreenShare:true,allowChat:true,allowMicrophone:true,allowCamera:true,allowReactions:true},
   onClose:()=>{},
  }));
  expect(html).toContain('Co-hosts: 5 of 5');
  expect(html).toContain('All five co-host seats are in use');
  expect(html).toContain('Make co-host</button>');
  expect(html).toMatch(/disabled="" aria-describedby="host-cohost-limit" title="The meeting can have no more than five co-hosts\."/);
  expect(html).not.toContain('Quick access');
 });
});
