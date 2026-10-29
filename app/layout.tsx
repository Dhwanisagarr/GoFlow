import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Go with the flow — one task at a time', description: 'A calmer day, one task at a time.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
