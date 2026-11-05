/**
 * Vercel serverless fallback for guest meeting creation.
 * Used when Render meeting/signaling services are cold or stale.
 */
const { createMeetingInviteToken } = require('../../shared/meeting-invitation.cjs');

function generateMeetingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return `QS-${segments.join('-')}`;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const meetingCode = generateMeetingCode();
  const inviteToken = createMeetingInviteToken(meetingCode);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'qs-vc.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';

  return res.status(200).json({
    meetingCode,
    inviteToken,
    joinUrl: `${proto}://${host}/meeting/${meetingCode}/preview?invite=${encodeURIComponent(inviteToken)}`,
    source: 'vercel-api',
  });
};
