import type { Direction } from "../../../world/tileWorld";

export type ControlState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export function getDirectionFromControls(controls: ControlState): Direction | null {
  if (controls.up) return "up";
  if (controls.down) return "down";
  if (controls.left) return "left";
  if (controls.right) return "right";
  return null;
}
