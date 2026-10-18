import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (node: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function api(): TurnstileApi | null {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null;
}

export function TurnstileField({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (token: string) => void; resetKey: number }) {
  const node = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    const scriptId = "cf-turnstile";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.appendChild(script);
    }
    let cancelled = false;
    const render = () => {
      const turnstile = api();
      if (!turnstile || !node.current || cancelled) {
        if (!cancelled) window.setTimeout(render, 80);
        return;
      }
      if (widget.current) turnstile.remove(widget.current);
      widget.current = turnstile.render(node.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
      });
    };
    render();
    return () => {
      cancelled = true;
      if (widget.current) api()?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, resetKey]);

  return <div ref={node} className="min-h-16" />;
}

export function authHeaders(token: string) {
  return token ? { fetchOptions: { headers: { "x-turnstile-token": token } } } : {};
}
