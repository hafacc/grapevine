import type { ReactElement, ReactNode } from "react";
import { Mark } from "../wordmark";

/**
 * What a screen says when its list has nothing in it: the mark over one line,
 * in the middle of the space the rows would fill. One look for every empty
 * list, so an empty search and an empty feed read as the same kind of fact.
 */
export default function CenteredNote({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-grow flex-col items-center justify-center gap-5 px-8 text-center">
      <Mark />
      <p className="text-[17px] leading-[1.55] [overflow-wrap:anywhere]">
        {children}
      </p>
      {action}
    </div>
  );
}
