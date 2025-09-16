// Minimal safe wrapper for LG webOS APIs with fallbacks
export function initWebOS(onBack){
  if(typeof window !== 'undefined' && window.PalmSystem){
    try{
      // webOS has different platform APIs; this covers the common case
      document.addEventListener('webOSKey', (e)=>{
        if(e && e.keyName === 'Back') onBack && onBack();
      });
    }catch(e){
      console.warn('webOS key listener not available', e);
    }
  } else if(typeof window !== 'undefined' && window.webOSReady){
    // older webOS embed
    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Backspace' || e.key === 'Escape') onBack && onBack();
    });
  } else {
    // fallback for browsers
    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape') onBack && onBack();
    });
  }
}

export function requestSystemInfo(){
  if(typeof window !== 'undefined' && window.navigator && window.navigator.userAgent){
    return {ua: window.navigator.userAgent};
  }
  return {ua: 'unknown'};
}
