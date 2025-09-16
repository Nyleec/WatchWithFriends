// Minimal safe wrapper for LG webOS APIs with fallbacks
export function initWebOS(onBack, onKey){
  const addKeyListener = (handler)=>{
    if(typeof document !== 'undefined'){
      // webOS emits 'webOSKey' in some environments
      document.addEventListener('webOSKey', handler);
      // also listen to standard keydown as fallback
      window.addEventListener('keydown', handler);
    }
  };

  const handler = (e)=>{
    try{
      // Normalize for webOS event
      const keyName = e && (e.keyName || e.key || (e.code && e.code));
      if(keyName === 'Back' || keyName === 'Backspace' || keyName === 'Escape'){
        onBack && onBack(e);
      }
      onKey && onKey(keyName, e);
    }catch(ignore){ }
  };

  addKeyListener(handler);
  return ()=>{
    if(typeof document !== 'undefined'){
      document.removeEventListener('webOSKey', handler);
      window.removeEventListener('keydown', handler);
    }
  };
}

export function requestSystemInfo(){
  if(typeof window !== 'undefined' && window.navigator && window.navigator.userAgent){
    return {ua: window.navigator.userAgent};
  }
  return {ua: 'unknown'};
}

// Media service wrapper for webOS: play/pause/seek/volume
function hasWebOSService(){
  return (typeof window !== 'undefined' && typeof window.webOS !== 'undefined' && typeof window.webOS.service !== 'undefined')
    || (typeof window !== 'undefined' && typeof window.PalmSystem !== 'undefined' && typeof window.PalmSystem.launchWebApp !== 'undefined');
}

export const MediaService = {
  async _request(uri, options){
    if(!hasWebOSService()) throw new Error('webOS service not available');
    return new Promise((resolve, reject)=>{
      try{
        window.webOS.service.request(uri, Object.assign({}, options, {
          onSuccess: (res)=> resolve(res),
          onFailure: (err)=> reject(err)
        }));
      }catch(e){ reject(e); }
    });
  },
  async play(appId){
    try{ await this._request('luna://com.webos.media', {method:'play', parameters:{appId}}); return {ok:true}; }
    catch(e){ return {ok:false, error:e}; }
  },
  async pause(){
    try{ await this._request('luna://com.webos.media', {method:'pause'}); return {ok:true}; }
    catch(e){ return {ok:false, error:e}; }
  },
  async seek(seconds){
    try{ await this._request('luna://com.webos.media', {method:'seek', parameters:{position: seconds}}); return {ok:true}; }
    catch(e){ return {ok:false, error:e}; }
  },
  async setVolume(level){
    try{ await this._request('luna://com.webos.audio', {method:'setVolume', parameters:{volume: level}}); return {ok:true}; }
    catch(e){ return {ok:false, error:e}; }
  },
  async getStatus(){
    try{ const res = await this._request('luna://com.webos.media', {method:'getStatus'}); return {ok:true, status:res}; }
    catch(e){ return {ok:false, error:e}; }
  },
  subscribeToStatus(callback){
    if(!hasWebOSService()) return ()=>{};
    // Many webOS services use subscription via `subscribe: true` and repeated callbacks
    const sub = { onSuccess: callback, onFailure: (e)=> console.warn('subscribe failed', e) };
    try{
      const req = window.webOS.service.request('luna://com.webos.media', {method:'getStatus', subscribe:true, onSuccess:callback, onFailure:(e)=>console.warn('subscribe failed', e)});
      return ()=>{ try{ req.cancel(); }catch(_){ } };
    }catch(e){ console.warn('subscribeToStatus failed', e); return ()=>{}; }
  }
};
