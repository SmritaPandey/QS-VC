# On-prem AI gateway

The optional gateway accepts non-streaming OpenAI-compatible chat requests on
its internal port. The policy chooses the model. Use local Ollama or vLLM
with an OpenAI-compatible endpoint, OpenRouter with a client-provided key,
or an approved custom HTTPS endpoint. For OpenRouter, configure discovery or
set freeRouter to openrouter/free. Discovery considers only :free variants
and ranks by configured tags, then advertised context length. Availability and
quotas change. [OpenRouter free router](https://openrouter.ai/openrouter/free/) ·
[Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)

Install the signed release. Create a client-owned /var/lib/qsvc/ai directory
readable only by its operator and the gateway container identity (UID 65534).
Copy the example policy as policy.json. Set a random gateway-token file
and the matching QSVC_AI_GATEWAY_TOKEN in the private Compose environment.
Enable QSVC_AI_GATEWAY_ENABLED and supply QSVC_AI_MINUTES_MODEL as the
summary request model identifier. The gateway selects the upstream model
from its policy. Start Compose with --profile ai-gateway.

To enable summaries, add a summaries feature route with provider, model for
local/custom, and hourlyLimit. OpenRouter model selection uses discovery or
the configured free router. No provider is enabled by the shipped policy.
For a local AI backend, attach the approved service to the app network under
the configured Ollama/vLLM name, or use an approved private IP. Keep network
egress deny rules in place for air-gapped and high-assurance deployments.

## Egress and key custody

**External AI sends the selected meeting text to the provider.** Before
enabling a route, an administrator must approve the provider's retention,
processing region and contractual terms. Record the approval and set both
allowExternal and egressWarningAcknowledged on that feature in the standard
profile. High-assurance and air-gapped profiles reject external routes even
with both flags. Classified or unrecognized data classes are blocked.
Signaling refuses summary processing for E2EE rooms.

Seal a client credential with crypto/envelope.mjs and a separate private
32-byte wrapping key. Supply the encrypted file and wrapping key through
restricted read-only runtime storage. The gateway unwraps the credential
in memory and writes neither it nor prompts to logs. This is file-backed
custody. A production HSM adapter and central signed audit integration
remain pending. Use runtime log forwarding for the metadata events
(event name, timestamp, feature, provider, operation, status and duration).
Usage counts are per process and hour and reset on restart.

## Integration status

Meeting summaries are wired. Captions and search have gateway policy and usage
slots for future callers. Existing ASR, translation and search flows do not
send content to the gateway by default. Neither the gateway nor provider
availability blocks core meeting traffic.
