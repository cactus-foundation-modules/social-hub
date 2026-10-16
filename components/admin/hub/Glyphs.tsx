import type { Provider } from '@/modules/social-hub/lib/types'

// Plain geometric marks for the two networks. They stand in for logos: a letter in the
// network's own colour, drawn as text-free paths so nothing depends on a font.

export function ProviderGlyph({ provider, size = 14 }: { provider: Provider; size?: number }) {
  return provider === 'facebook' ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M14 8.5V6.9c0-.8.2-1.2 1.3-1.2H17V2.2C16.6 2.1 15.600 2 14.500 2 11.900 2 10 3.600 10 6.600v1.900H7V12h3v10h4V12h2.800l.4-3.500z" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M4.200 8.800h3.300V20H4.200zM5.800 3.500a1.900 1.900 0 1 1 0 3.800 1.900 1.900 0 0 1 0-3.800zM9.800 8.800H13v1.500h.1c.5-.9 1.600-1.800 3.300-1.800 3.500 0 4.100 2.300 4.100 5.300V20h-3.300v-5.400c0-1.300 0-2.900-1.800-2.900s-2 1.400-2 2.800V20H9.800z" />
    </svg>
  )
}

export function Icon({ name, size = 16 }: { name: 'plus' | 'refresh' | 'close' | 'image' | 'link' | 'clock' | 'chevron' | 'external' | 'check' | 'warn' | 'like' | 'comment' | 'share' | 'trash' | 'edit' | 'send' | 'more'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (name) {
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'refresh': return <svg {...common}><path d="M20 11a8 8 0 0 0-14.500-4M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.500 4M20 19v-4h-4" /></svg>
    case 'close': return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>
    case 'image': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.500" /><path d="M21 16l-5-5-8 8" /></svg>
    case 'link': return <svg {...common}><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></svg>
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    case 'chevron': return <svg {...common}><path d="M9 6l6 6-6 6" /></svg>
    case 'external': return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    case 'check': return <svg {...common}><path d="M5 12.500l4.500 4.500L19 7" /></svg>
    case 'warn': return <svg {...common}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.500v.01" /></svg>
    case 'like': return <svg {...common}><path d="M7 11v9H4v-9zM7 11l4-7c1.500 0 2.500 1 2.200 2.500L12.800 9H19a2 2 0 0 1 2 2.300l-1 6.500A2 2 0 0 1 18 20H7" /></svg>
    case 'comment': return <svg {...common}><path d="M4 5h16v11H9l-5 4z" /></svg>
    case 'share': return <svg {...common}><path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M16 6l-4-4-4 4M12 2v13" /></svg>
    case 'trash': return <svg {...common}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
    case 'edit': return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
    case 'send': return <svg {...common}><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></svg>
    case 'more': return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.800" /><circle cx="12" cy="12" r="1.800" /><circle cx="12" cy="19" r="1.800" /></svg>
  }
}
