import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, type DateRange, type DayPickerProps } from "react-day-picker"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

import "react-day-picker/style.css"

export type CalendarProps = DayPickerProps

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      className={cn("rdp pt-0", className)}
      classNames={{
        month_caption: "flex h-7 w-full items-center justify-center px-0",
        caption_label: "text-sm font-medium",
        nav: "absolute top-0 flex w-full items-center justify-between px-0.5",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 p-0",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 p-0",
        ),
        month_grid: "w-full border-collapse",
        weekday: "text-muted-foreground w-8 text-center text-xs font-normal",
        day: "relative w-8 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "text-foreground h-8 w-8 p-0 font-normal",
        ),
        range_start: "day-range-start rounded-s-md",
        range_end: "day-range-end rounded-e-md",
        range_middle: "bg-muted !text-foreground rounded-none",
        /** Modo single: fundo cinza visível (default do RDP é quase só borda). */
        selected: cn(
          "!bg-transparent rounded-md font-medium",
          "[&>button]:!border-0",
          "[&>button]:!bg-zinc-500/90 [&>button]:!text-zinc-50",
          "dark:[&>button]:!bg-zinc-500 dark:[&>button]:!text-zinc-50",
        ),
        today: "bg-accent text-accent-foreground",
        outside: "text-muted-foreground/40",
        disabled: "text-muted-foreground/40",
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation, ...rest }) => {
          if (orientation === "right") {
            return (
              <ChevronRight
                className={cn("size-4", className)}
                aria-hidden
                {...rest}
              />
            )
          }
          return <ChevronLeft className={cn("size-4", className)} aria-hidden {...rest} />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar, type DateRange }
