'use client'
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hapio contributors
// @hapio/calendar registry 0.0.0 · contract 1

import { useDescriptions, type DescriptionItem } from '@hapio/calendar-react'
import { memo } from 'react'

/**
 * The hidden container of event descriptions ("Thursday, October 22, 2026, 09:00 to 10:30,
 * Chair 2"). Every event points at its item with `aria-describedby`, so events carry only their
 * visible text. Render it once inside the calendar root, outside the view's list or grid.
 * Memoized, and so is each item (by its id and text): a new model renders the container once
 * and only the items whose text changed (a drop: the moved event's).
 */
export const CalendarDescriptions = memo(function CalendarDescriptions() {
  const descriptions = useDescriptions()
  return (
    <div {...descriptions.getContainerProps()}>
      {descriptions.items.map((item) => (
        <Description key={item.id} id={item.id} text={item.text} />
      ))}
    </div>
  )
})

const Description = memo(function Description({ id, text }: DescriptionItem) {
  return <span id={id}>{text}</span>
})
