import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Pulso · Opiniones en Bluesky',description:'Analiza qué opiniones dominan entre los posts destacados de una tendencia de Bluesky.'};
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>){return <html lang="es"><body>{children}</body></html>}
