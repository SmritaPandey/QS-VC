const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const profiles = ['public', 'intranet'];
const states = ['candidate', 'triaged', 'reproduced', 'false-positive', 'accepted-risk', 'fixed'];
const present = value => typeof value === 'string' && value.trim().length > 0;
const validTime = (value, now) => present(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;

function assess(findings, evidence, now = Date.now()) {
    if (!Array.isArray(findings) || !Array.isArray(evidence)) throw new Error('Findings and evidence must be arrays');
    const ids = new Set();
    for (const [index, finding] of findings.entries()) {
        if (!finding || !present(finding.id) || ids.has(finding.id) || !present(finding.asset) ||
            !profiles.includes(finding.deployment) || !states.includes(finding.status)) {
            throw new Error(`Invalid or duplicate finding at index ${index}`);
        }
        ids.add(finding.id);
        if (finding.status === 'reproduced') {
            if (!present(finding.evidence) || !present(finding.reproducedBy) || !validTime(finding.reproducedOn, now)) {
                throw new Error(`Finding ${finding.id} requires reproduction evidence, author and date`);
            }
            if (finding.vector !== undefined && !/^CVSS:4\.0\/AV:[NALP]\/AC:[LH]\/AT:[NP]\/PR:[NLH]\/UI:[NPA]\/VC:[HLN]\/VI:[HLN]\/VA:[HLN]\/SC:[HLN]\/SI:[HLN]\/SA:[HLN]$/.test(finding.vector)) {
                throw new Error(`Finding ${finding.id} requires a canonical CVSS v4.0 Base vector`);
            }
        } else if (finding.vector !== undefined) {
            throw new Error(`Finding ${finding.id} cannot carry a vector before reproduction`);
        }
    }
    const evidenceIds = new Set();
    for (const [index, item] of evidence.entries()) {
        if (!item || !present(item.id) || evidenceIds.has(item.id) || !profiles.includes(item.deployment) ||
            !present(item.revision) || !present(item.artifact) || !present(item.collectedBy) ||
            !validTime(item.collectedOn, now) || !['pending', 'pass', 'fail'].includes(item.result)) {
            throw new Error(`Invalid or duplicate evidence at index ${index}`);
        }
        evidenceIds.add(item.id);
        if (item.result === 'pass' && (!present(item.reviewedBy) ||
            item.reviewedBy.trim().toLowerCase() === item.collectedBy.trim().toLowerCase())) {
            throw new Error(`Evidence ${item.id} requires a separate reviewer`);
        }
    }
    return Object.fromEntries(profiles.map(deployment => [deployment, {
        conformity: 'unverified',
        findings: findings.filter(item => item.deployment === deployment).length,
        reproduced: findings.filter(item => item.deployment === deployment && item.status === 'reproduced').length,
        evidenceEntries: evidence.filter(item => item.deployment === deployment).length,
    }]));
}

if (require.main === module) {
    const load = name => JSON.parse(readFileSync(join(__dirname, name), 'utf8'));
    try {
        console.log(JSON.stringify(assess(load('findings.json'), load('evidence.json')), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { assess };
