import { useEffect, useState } from "react";

export function ProofMedia({ url, type, title }: { url: string; type?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <>
    {failed ? <p className="media-fallback">Preview unavailable in this browser. The original file is still saved.</p>
      : type?.startsWith("video/")
        ? <video className="proof-image" src={url} controls playsInline preload="metadata" aria-label={`Evidence video for ${title}`} onError={() => setFailed(true)} />
        : <img className="proof-image" src={url} alt={`Evidence image for ${title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    <a className="media-download" href={url} download rel="noreferrer">Download original</a>
  </>;
}
