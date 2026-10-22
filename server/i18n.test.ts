import { describe, expect, it } from "vitest";
import { translate } from "../shared/i18n/index.ts";

describe("Spanish", () => {
  it("translates phrases, keeping the spaces around them", () => {
    expect(translate("Your season", "es")).toBe("Tu temporada");
    expect(translate(" won ", "es")).toBe(" ganadas ");
    expect(translate("Your season", "en")).toBe("Your season");
    expect(translate("End turn → Opponent", "es")).toBe("Fin del turno → Rival");
    expect(translate("End turn → Sebastián", "es")).toBe("Fin del turno → Sebastián");
    expect(translate("Opponent's turn.", "es")).toBe("Turno de Rival.");
  });

  it("translates text with names and numbers, and pieces inside it", () => {
    expect(translate("Next: Combat", "es")).toBe("Siguiente: Combate");
    expect(translate("Diego's turn", "es")).toBe("Turno de Diego");
    expect(translate("Undo round 2 pairings", "es")).toBe("Deshacer emparejamientos de la ronda 2");
    expect(translate("Goy: Control at least 1 objective (+3)", "es")).toBe("Goy: Controlar al menos 1 objetivo (+3)");
    expect(translate("Comeback win for Goy", "es")).toBe("Remontada de Goy");
  });

  it("leaves what it doesn't know alone (names, numbers, rules)", () => {
    expect(translate("Goy", "es")).toBe("Goy");
    expect(translate("30", "es")).toBe("30");
    expect(translate("30 VP", "es")).toBe("30 VP");
    expect(translate("Siege of Ashes", "es")).toBe("Siege of Ashes");
  });

  it("translates notifications", () => {
    expect(translate("October Cup, round 2: you play Diego at table 3.", "es")).toBe("October Cup, ronda 2: juegas contra Diego en la mesa 3.");
    expect(translate("⚔️ Ana challenges you to a 1000-point game.", "es")).toBe("⚔️ Ana te desafía a una partida a 1000 puntos.");
  });
});
