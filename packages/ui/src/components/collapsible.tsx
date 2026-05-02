import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { useRef } from "react"

function Collapsible({ open, ...props }: CollapsiblePrimitive.Root.Props) {
  const isControlledRef = useRef(open !== undefined)

  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      {...props}
      {...(isControlledRef.current ? { open: open ?? false } : {})}
    />
  )
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
