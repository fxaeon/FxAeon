import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
export const metadata: Metadata = routeMetadata('send');
export default function SendLayout({ children }: { children: React.ReactNode }) { return children; }
