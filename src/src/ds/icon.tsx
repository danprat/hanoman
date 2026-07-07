import { icons } from "lucide-react";
import type React from "react";
export function Icon({ name, size = 16, ...rest }: { name: string; size?: number } & React.SVGProps<SVGSVGElement>) {
  const Cmp = (icons as Record<string, React.FC<any>>)[toPascal(name)] ?? icons.Circle;
  return <Cmp width={size} height={size} {...rest} />;
}
const toPascal = (s: string) => s.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
