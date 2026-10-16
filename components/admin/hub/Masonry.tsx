'use client'

import { Children, useEffect, useState, type ReactNode } from 'react'

const WIDE = '(min-width: 900px)'

/**
 * Two columns on a desktop, one elsewhere. Posts are dealt out across the columns in
 * turn - first left, second right, third left - so reading along each row is date order,
 * and each column then stacks its own cards with no gaps, whatever height they are.
 * (CSS `columns` fills a whole column before starting the next, which would put the
 * second-newest post at the bottom of the left-hand column.)
 */
export function Masonry({ children }: { children: ReactNode }) {
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const items = Children.toArray(children)
  const count = wide ? 2 : 1
  const columns: ReactNode[][] = Array.from({ length: count }, () => [])
  items.forEach((item, i) => columns[i % count]!.push(item))

  return (
    <div className="shub-masonry">
      {columns.map((col, i) => <div className="shub-masonry-col" key={i}>{col}</div>)}
    </div>
  )
}
