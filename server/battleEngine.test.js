import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateDamageWithTypes, resolvePvpTurn } from "./battleEngine.js";

describe("battle engine", () => {
  it("applies STAB and super-effective Ember vs Grass", () => {
    const rng = () => 0.5;
    const result = calculateDamageWithTypes(
      { attack: 10, defense: 10, specialAttack: 12, specialDefense: 10, speed: 10 },
      { attack: 10, defense: 10, specialAttack: 10, specialDefense: 8, speed: 10 },
      40,
      "special",
      5,
      "fire",
      ["grass"],
      ["fire"],
      rng
    );
    assert.equal(result.effectiveness, "super");
    assert.ok(result.damage > 0);
  });

  it("continues PvP after lead faints if bench remains", () => {
    const state = {
      players: [
        {
          id: "a",
          name: "Ash",
          team: [
            { name: "Charmander", hp: 1, maxHp: 20, level: 5, types: ["fire"], stats: { attack: 20, defense: 5, speed: 20, specialAttack: 20, specialDefense: 5 }, moves: ["ember"] },
            { name: "Pidgey", hp: 18, maxHp: 18, level: 5, types: ["normal"], stats: { attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 } },
          ],
        },
        {
          id: "b",
          name: "Gary",
          team: [
            { name: "Bulbasaur", hp: 4, maxHp: 20, level: 5, types: ["grass"], stats: { attack: 5, defense: 5, speed: 5, specialAttack: 5, specialDefense: 5 }, moves: ["tackle"] },
            { name: "Rattata", hp: 16, maxHp: 16, level: 5, types: ["normal"], stats: { attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 } },
          ],
        },
      ],
      pvpBattle: {
        challengerId: "a",
        defenderId: "b",
        challengerIndex: 0,
        defenderIndex: 0,
        status: "waiting_moves",
        challengerMove: "ember",
        defenderMove: "tackle",
        log: [],
      },
    };
    resolvePvpTurn(state, () => 0.99);
    assert.ok(state.pvpBattle.status === "waiting_switch" || state.pvpBattle.status === "ended" || state.pvpBattle.status === "waiting_moves");
    if ((state.players[1].team[0].hp ?? 0) <= 0 && (state.players[1].team[1].hp ?? 0) > 0) {
      assert.equal(state.pvpBattle.status, "waiting_switch");
      assert.equal(state.pvpBattle.mustSwitch, "defender");
      assert.notEqual(state.pvpBattle.winner, "challenger");
    }
  });
});
