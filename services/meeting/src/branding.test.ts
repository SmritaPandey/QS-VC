import { afterEach, expect, it, vi } from 'vitest';
import type { Express, RequestHandler } from 'express';
import { deflateSync } from 'node:zlib';
import { brandingBody, DEFAULT_BRANDING, registerBrandingRoutes, validBrandLogo } from './branding.js';
import { meetingAuth } from './auth.js';
function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for(let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function png(width = 1, height = 1) {
    const chunk = (type: string, data: Buffer) => { const out = Buffer.alloc(data.length + 12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out; };
    const header = Buffer.alloc(13); header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
    return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
afterEach(() => { vi.unstubAllEnvs();vi.unstubAllGlobals(); });
it('accepts bounded raster PNGs and rejects remote, active, malformed and oversized image data', () => {
    expect(validBrandLogo(png())).toBe(true);
    for(const image of ['https://tracker.example/logo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YmFk',png(513), png().slice(0,-4)]) expect(validBrandLogo(image)).toBe(false);
    const corrupt = Buffer.from(png().slice(22),'base64');corrupt[corrupt.length-1] ^= 255;
    expect(validBrandLogo('data:image/png;base64,'+corrupt.toString('base64'))).toBe(false);
});
it('rejects cross-tenant fields, control characters and unsafe accent values', () => {
    expect(brandingBody.safeParse({...DEFAULT_BRANDING,organisationName:'Department'}).success).toBe(true);
    for(const change of [{tenantId:'another'}, {organisationName:'\u0000Admin'}, {organisationName:' '}, {accent:'url(https://tracking.example)'}, {logoDataUrl:'https://tracking.example/logo.png'}]) expect(brandingBody.safeParse({...DEFAULT_BRANDING,...change}).success).toBe(false);
});
function setup(role = 'admin') {
    const routes = new Map<string, RequestHandler[]>();
    const app = {get:(path:string,...handlers:RequestHandler[])=>routes.set('GET '+path,handlers),patch:(path:string,...handlers:RequestHandler[])=>routes.set('PATCH '+path,handlers)} as unknown as Express;
    const query = vi.fn().mockResolvedValue({ rows: [] }), rawQuery = vi.fn().mockResolvedValue({rows:[{tenant_id:'meeting-tenant'}]});
    const runWithTenant = vi.fn(async (_tenant:string,fn:()=>unknown)=>fn());
    const auth = meetingAuth('http://auth', runWithTenant);
    registerBrandingRoutes(app,{query,runWithTenant} as any,{query:rawQuery} as any,auth);
    vi.stubEnv('INTERNAL_AUTH_SECRET','branding-test-secret-that-is-long-enough');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({valid:true,payload:{sub:'admin',role,tenantId:'own-tenant'}})}));
    const req:any={headers:{authorization:'Bearer verified'},body:{...DEFAULT_BRANDING,organisationName:'Department'},params:{code:'qs-meeting'}};
    const res:any={setHeader:vi.fn(),status:vi.fn(),json:vi.fn(),sendStatus:vi.fn()};res.status.mockReturnValue(res);
    async function call(method:string,path:string){const handlers=routes.get(method+' '+path)!;const dispatch=async(i:number):Promise<unknown>=>handlers[i]?.(req,res,()=>dispatch(i+1));await dispatch(0);await vi.waitFor(()=>expect(res.json.mock.calls.length+res.sendStatus.mock.calls.length).toBeGreaterThan(0));}
    return {req,res,query,rawQuery,runWithTenant,call};
}
it('requires authentication and prevents ordinary members from changing branding',async()=>{
    const anonymous=setup();anonymous.req.headers={};await anonymous.call('PATCH','/api/meetings/branding');expect(anonymous.res.status).toHaveBeenCalledWith(401);expect(anonymous.query).not.toHaveBeenCalled();
    const member=setup('member');await member.call('PATCH','/api/meetings/branding');expect(member.res.status).toHaveBeenCalledWith(403);expect(member.query).not.toHaveBeenCalled();
});
it('persists an admin change only for the verified tenant and rejects supplied tenant overrides',async()=>{
    const ctx=setup();await ctx.call('PATCH','/api/meetings/branding');
    expect(ctx.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(tenant_id)'),['own-tenant','Department',null,'#006d77']);expect(ctx.runWithTenant).toHaveBeenCalledWith('own-tenant',expect.any(Function));
    const other=setup();other.req.body.tenantId='other-tenant';await other.call('PATCH','/api/meetings/branding');expect(other.res.status).toHaveBeenCalledWith(400);expect(other.query).not.toHaveBeenCalled();
});
it('reads safe defaults for the authenticated tenant without exposing tenant metadata',async()=>{
    const ctx=setup();await ctx.call('GET','/api/meetings/branding');expect(ctx.query).toHaveBeenCalledWith(expect.any(String),['own-tenant']);expect(ctx.res.json).toHaveBeenCalledWith(DEFAULT_BRANDING);
});
it('resolves guest meeting branding by its meeting tenant with no arbitrary tenant input',async()=>{
    const ctx=setup();ctx.query.mockResolvedValue({rows:[{organisationName:'Meeting department',logoDataUrl:null,accent:'#123456'}]});
    await ctx.call('GET','/api/meetings/code/:code/branding');expect(ctx.rawQuery).toHaveBeenCalledWith(expect.any(String),['QS-MEETING']);expect(ctx.runWithTenant).toHaveBeenCalledWith('meeting-tenant',expect.any(Function));expect(ctx.query).toHaveBeenCalledWith(expect.any(String),['meeting-tenant']);
    expect(ctx.res.json).toHaveBeenCalledWith({organisationName:'Meeting department',logoDataUrl:null,accent:'#123456'});
});
it('returns not found for unknown meetings and sanitizes database failures',async()=>{
    const missing=setup();missing.rawQuery.mockResolvedValue({rows:[]});await missing.call('GET','/api/meetings/code/:code/branding');expect(missing.res.sendStatus).toHaveBeenCalledWith(404);expect(missing.query).not.toHaveBeenCalled();
    const failed=setup();failed.query.mockRejectedValue(new Error('secret-database-host'));await failed.call('PATCH','/api/meetings/branding');expect(failed.res.status).toHaveBeenCalledWith(503);expect(failed.res.json).toHaveBeenCalledWith({error:'Organisation branding could not be saved.'});
});
