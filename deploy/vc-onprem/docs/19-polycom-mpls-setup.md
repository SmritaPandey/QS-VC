# Connect Polycom rooms over MPLS

FreeSWITCH runs on the hub MCU host. It receives calls from Poly room systems
and bridges conference media to QS-VC. The QS-VC portal remains the browser
interface for meetings and administration. Branch endpoints use the private MCU
address over Airtel MPLS.

1. Ask the customer network team for the hub MCU address, the branch endpoint
   subnets and return routes. Check DNS and time sync at both ends. Keep SIP ALG
   off on this path. Confirm that each branch can reach the MCU and receive RTP
   back from it.
2. Choose the endpoint protocol. For SIP, configure the Poly system to use the
   hub MCU SIP server or proxy. Set its assigned extension, credentials, and
   TLS/SRTP settings to match the MCU profile. Install the issuing CA on devices
   that use TLS. For legacy H.323, configure an approved H.323 gateway or
   Poly RMX/DMA path first. Verify its gatekeeper and negotiated media ports
   with the gateway owner. The server package alone does not provide that path.
3. Configure the hub bridge using the [Poly bridge guide](../../poly-bridge/README.md).
   Set the authorized tenant and room inventory so a number such as 1001
   resolves to its intended room. Use separate device credentials. Keep
   drachtio administration, FreeSWITCH ESL and the SFU control API on the
   private management or service network.
4. Request scoped branch-to-MCU firewall rules. Common SIP listeners are
   5060 TCP/UDP or 5061 TCP for TLS. Allow the configured RTP/RTCP UDP range
   in both directions. Use the MCU profile's actual port range rather than
   opening every port. For H.323, use the gateway's confirmed signaling and
   media rules. See the [MPLS matrix](03-network-mpls-requirements.md).
5. Dial the assigned number on a branch Poly device with no browser present.
   Confirm it lands in the right room. Join from a browser and verify audio
   and video both ways, then add a second Poly device. Test an unknown number,
   a PIN-protected room, a disabled device and expired activation. Record
   results and agreed admission behavior before enabling production use.

The Rocky 9 MCU install and physical Polycom call tests remain unverified.
The existing FreeSWITCH installer targets Debian-family systems. For a Rocky 9
deployment, confirm the customer's approved FreeSWITCH build or gateway before
enabling the bridge.
