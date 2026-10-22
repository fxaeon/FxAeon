'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keep bookmarks to the former full manuals useful without delivering a
 * second copy of every topic. Unknown and skip-link fragments stay local. */
export default function LegacyDocsRedirect({ destinations }: { destinations: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const follow = () => {
      let fragment = window.location.hash.slice(1);
      try { fragment = decodeURIComponent(fragment); } catch { return; }
      const destination = Object.hasOwn(destinations, fragment) ? destinations[fragment] : undefined;
      if (destination) router.replace(destination);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [destinations, router]);
  return null;
}
