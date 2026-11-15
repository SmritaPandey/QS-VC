import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import TenantBrand from '../components/TenantBrand';
import { DEFAULT_BRANDING, prepareBrandLogo } from './branding';
afterEach(() => vi.unstubAllGlobals());
it('renders the organisation identity with QS-VC attribution and a decorative accent', () => {
    const html = renderToStaticMarkup(createElement(TenantBrand, { branding: { organisationName:'State <Department>', logoDataUrl:null, accent:'#cc8833' }, meeting:true }));
    expect(html).toContain('State &lt;Department&gt;');expect(html).toContain('Powered by QS-VC');expect(html).toContain('border-color:#cc8833');expect(html).not.toMatch(/(?:style="|;)color:/);
});
it('retains the incumbent product identity when no branding is configured', () => {
    const html=renderToStaticMarkup(createElement(TenantBrand,{branding:DEFAULT_BRANDING}));expect(html).toContain('QS-VC');expect(html).toContain('qsvc-logo');
});
it('rejects active or oversized local files before decoding',async()=>{
    const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
    await expect(prepareBrandLogo({type:'image/svg+xml',size:50} as File)).rejects.toThrow('Choose a PNG');
    await expect(prepareBrandLogo({type:'image/png',size:3*1024*1024} as File)).rejects.toThrow('under 2 MB');expect(decode).not.toHaveBeenCalled();
});
it('bounds uploaded image dimensions, re-encodes PNG and releases the decoded bitmap',async()=>{
    const bitmap={width:1024,height:512,close:vi.fn()};vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue(bitmap));
    const drawImage=vi.fn(),toDataURL=vi.fn().mockReturnValue('data:image/png;base64,validated');
    const canvas={width:0,height:0,getContext:()=>({drawImage}),toDataURL};vi.stubGlobal('document',{createElement:()=>canvas});
    await expect(prepareBrandLogo({type:'image/jpeg',size:1000} as File)).resolves.toBe('data:image/png;base64,validated');expect(canvas.width).toBe(256);expect(canvas.height).toBe(128);expect(toDataURL).toHaveBeenCalledWith('image/png');expect(bitmap.close).toHaveBeenCalled();
});
