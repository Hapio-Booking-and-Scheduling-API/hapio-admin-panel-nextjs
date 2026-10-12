import { CalendarController } from '@fullcalendar/react'
import { EventCalendarNextIcon, EventCalendarPrevIcon } from '@/components/event-calendar-icons'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export interface EventCalendarToolbarProps {
  className?: string
  controller: CalendarController
  availableViews: string[]
  addButton?: {
    isPrimary?: boolean
    text?: string
    hint?: string
    click?: (ev: MouseEvent) => void
  }
}

export function EventCalendarToolbar({
  className,
  controller,
  availableViews,
  addButton,
}: EventCalendarToolbarProps) {
  const buttons = controller.getButtonState()

  return (
    <div className={cn('flex items-center justify-between flex-wrap gap-3', className)}>
      {/* Wraps on narrow screens, so a long title moves to its own line instead of being clipped. */}
      <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
        {addButton && (
          <Button
            onClick={(ev) => addButton.click?.(ev.nativeEvent)}
            aria-label={addButton.hint}
          >{addButton.text}</Button>
        )}
        <Button
          onClick={() => controller.today()}
          aria-label={buttons.today.hint}
          variant='outline'
        >{buttons.today.text}</Button>
        <div className='flex items-center'>
          <Button
            onClick={() => controller.prev()}
            disabled={buttons.prev.isDisabled}
            aria-label={buttons.prev.hint}
            variant='ghost'
            size='icon'
          >
            <EventCalendarPrevIcon />
          </Button>
          <Button
            onClick={() => controller.next()}
            disabled={buttons.next.isDisabled}
            aria-label={buttons.next.hint}
            variant='ghost'
            size='icon'
          >
            <EventCalendarNextIcon />
          </Button>
        </div>
        <div className='min-w-0 text-lg sm:text-xl'>{controller.view?.title}</div>
      </div>
      {/* A single-choice group (radios), not tabs: there are no tab panels to point at. */}
      <ToggleGroup
        type='single'
        variant='outline'
        spacing={0}
        value={controller.view?.type ?? availableViews[0]}
        onValueChange={(view) => view && controller.changeView(view)}
        aria-label='Calendar view'
      >
        {availableViews.map((availableView) => (
          <ToggleGroupItem
            key={availableView}
            value={availableView}
            aria-label={buttons[availableView]?.hint}
          >{buttons[availableView]?.text}</ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
