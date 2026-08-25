import * as Phaser from "phaser";
import type { Direction } from "../../../world/tileWorld";
import { publicUrl } from "../../../publicUrl";

export const OW_SHEETS = {
  red: { key: "ow-red", url: publicUrl("assets/pokefirered/overworld/red_normal.png") },
  leaf: { key: "ow-leaf", url: publicUrl("assets/pokefirered/overworld/green_normal.png") },
  oak: { key: "ow-oak", url: publicUrl("assets/pokefirered/overworld/prof_oak.png") },
  woman: { key: "ow-woman", url: publicUrl("assets/pokefirered/overworld/woman_1.png") },
  fatMan: { key: "ow-fat-man", url: publicUrl("assets/pokefirered/overworld/fat_man.png") },
  mom: { key: "ow-mom", url: publicUrl("assets/pokefirered/overworld/mom.png") },
  daisy: { key: "ow-daisy", url: publicUrl("assets/pokefirered/overworld/daisy.png") },
  blue: { key: "ow-blue", url: publicUrl("assets/pokefirered/overworld/blue.png") },
} as const;

const FRAME_W = 16;
const FRAME_H = 32;

export function playerSheetKey(spriteId?: string) {
  return spriteId === "leaf" ? OW_SHEETS.leaf.key : OW_SHEETS.red.key;
}

export function queueOverworldSheets(scene: Phaser.Scene) {
  for (const sheet of Object.values(OW_SHEETS)) {
    if (!scene.textures.exists(sheet.key)) {
      scene.load.spritesheet(sheet.key, sheet.url, { frameWidth: FRAME_W, frameHeight: FRAME_H });
    }
  }
}

/**
 * FireRed 16x32 OW strips (pret `sAnimTable_RedGreenNormal`):
 * 0 down idle, 1 up idle, 2 side idle,
 * 3-4 down walk, 5-6 up walk, 7-8 side walk. East = west + flipX.
 */
export function idleFrame(facing: Direction, sheetKey?: string): number {
  if (facing === "up") return 1;
  if (facing === "left" || facing === "right") return 2;
  return 0;
}

export function walkFrames(facing: Direction, sheetKey?: string): number[] {
  if (sheetKey === "ow-mom") {
    const idle = idleFrame(facing, sheetKey);
    return [idle, Math.min(idle + 1, 2), idle];
  }
  if (facing === "up") return [5, 1, 6, 1];
  if (facing === "left" || facing === "right") return [7, 2, 8, 2];
  return [3, 0, 4, 0];
}

export function animationKey(sheetKey: string, facing: Direction) {
  return `${sheetKey}-fr-walk-${facing}`;
}

export function ensureWalkAnims(scene: Phaser.Scene, sheetKey: string) {
  const facings: Direction[] = ["down", "up", "left", "right"];
  for (const facing of facings) {
    const key = animationKey(sheetKey, facing);
    if (scene.anims.exists(key)) scene.anims.remove(key);
    scene.anims.create({
      key,
      frames: walkFrames(facing, sheetKey).map((frame) => ({ key: sheetKey, frame })),
      frameRate: 8,
      repeat: -1,
    });
  }
}

export function applyFacingFlip(sprite: Phaser.GameObjects.Sprite, facing: Direction) {
  sprite.setFlipX(facing === "right");
}

export function playWalk(sprite: Phaser.GameObjects.Sprite, sheetKey: string, facing: Direction) {
  applyFacingFlip(sprite, facing);
  const key = animationKey(sheetKey, facing);
  if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
}

export function stopWalk(sprite: Phaser.GameObjects.Sprite, facing: Direction, sheetKey?: string) {
  sprite.anims.stop();
  sprite.setFrame(idleFrame(facing, sheetKey));
  applyFacingFlip(sprite, facing);
}
