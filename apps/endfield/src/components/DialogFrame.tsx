import type { ComponentProps, ReactNode, Ref } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { workbenchArtwork } from "@riic/endfield-data";

type Props = Omit<ComponentProps<typeof Dialog.Popup>, "title" | "children"> & {
  title: string;
  description?: string;
  closeLabel: string;
  closeRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
  footer: ReactNode;
  bodyClassName?: string;
};

/** Shared Endfield window chrome; each feature owns its body and actions. */
export function DialogFrame({ title, description, closeLabel, closeRef, children, footer, className = "", bodyClassName = "", ...props }: Props) {
  return <Dialog.Popup {...props} className={`ef-theme ef-dialog ${className}`}>
    <header className="ef-dialog-header">
      <Dialog.Title className="ef-dialog-title"><span className="ef-dialog-title-mark" aria-hidden="true" />{title}</Dialog.Title>
      <Dialog.Close ref={closeRef} className="ef-dialog-close" aria-label={closeLabel}>
        <span className="ef-dialog-close-glyph" style={{ maskImage: `url("${workbenchArtwork.ui.close.icon}")` }} aria-hidden="true" />
      </Dialog.Close>
    </header>
    <div className={`ef-dialog-body ${bodyClassName}`} data-yeye-scroll="auto">
      {description ? <Dialog.Description className="ef-dialog-description">{description}</Dialog.Description> : null}
      {children}
    </div>
    <footer className="ef-dialog-footer">{footer}</footer>
  </Dialog.Popup>;
}
