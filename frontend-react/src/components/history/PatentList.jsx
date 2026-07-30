import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import PatentCard from './PatentCard'

export default function PatentList({ patents, search, startSerial = 1 }) {
  const parentRef = useRef(null)

  const count = patents.length

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180, // estimated height of each patent card
    overscan: 5,
  })

  if (count === 0) {
    return <div className="meta-text" style={{ textAlign: 'center', padding: 20 }}>No patents matched this criteria.</div>
  }

  // If there are less than 15 patents, render directly without virtualization for pure simplicity and layout flexibility
  if (count <= 15) {
    return (
      <div className="patent-list">
        {patents.map((p, idx) => (
          <PatentCard
            key={p.id}
            patent={p}
            search={search}
            serial={startSerial + idx}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="patent-list virtual-patent-list"
      style={{
        maxHeight: '650px',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const p = patents[virtualRow.index]
          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <PatentCard
                patent={p}
                search={search}
                serial={startSerial + virtualRow.index}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
