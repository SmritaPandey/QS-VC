/**
 * Vercel serverless fallback for guest meeting creation.
 * Used when Render meeting/signaling services are cold or stale.
 */
const { createMeetingInviteToken } = require('../../shared/meeting-invitation.cjs');
const { randomInt } = require('node:crypto');

function generateMeetingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < 4; i++) {
      seg += chars[randomInt(chars.length)];
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
  // Never construct an invitation URL from caller-controlled Host/X-Forwarded-* headers.
  const configuredHost = process.env.QSVC_WEB_URL || process.env.VERCEL_URL || 'qs-vc.vercel.app';
  const host = configuredHost.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return res.status(200).json({
    meetingCode,
    inviteToken,
    joinUrl: `https://${host}/meeting/${meetingCode}/preview?invite=${encodeURIComponent(inviteToken)}`,
    source: 'vercel-api',
  });
};
