import { redirect } from 'next/navigation';
import { routeMetadata } from '@/app/routeMetadata';

export const metadata = routeMetadata('history');

/** Compatibility entry point; History is the canonical route. */
export default function ActivityCompatibilityPage() {
  redirect('/history');
}
