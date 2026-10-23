import { createContext, useContext, type ReactNode } from "react";
import { Button } from "@riic/ui-primitives/button";

export type AuthActionProps = {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  secondary?: boolean;
};
export type AuthActionRenderer = (props: AuthActionProps) => ReactNode;
export const AuthActionContext = createContext<AuthActionRenderer | undefined>(undefined);

export function AuthAction({ secondary = false, ...props }: AuthActionProps) {
  const renderAction = useContext(AuthActionContext);
  return renderAction ? renderAction({ ...props, secondary }) : <Button {...props} data-auth-action={secondary ? "secondary" : "primary"} variant={secondary ? "outline" : "default"} size="dialog" />;
}
