import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Polar Detector · Opiniones en Bluesky',description:'Analiza qué opiniones dominan entre los posts destacados de una tendencia de Bluesky.',icons:{icon:'/icon.png'}};
export const viewport: Viewport = {width:'device-width',initialScale:1};
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>){return <html lang="es"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet"/></head><body>{children}</body></html>}
