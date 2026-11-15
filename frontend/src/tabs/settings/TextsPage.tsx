import React, { useState, useEffect, useCallback } from "react";
import { useAccount } from "../../context";
import {
  CONTENT_SCOPES,
  SCOPE_LABELS,
  resolveDefaultScope,
  type ContentScope,
  type Archetype,
  type Bait,
  type ArchetypeInputItem,
  type BaitInputItem,
} from "../../types";
import {
  getArchetypes,
  putArchetypes,
  getBaits,
  putBaits,
} from "../../api";

export function TextsPage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount } = useAccount();

  // Step 4: Default scope opens pinned account role or "shared"
  const [activeScope, setActiveScope] = useState<ContentScope>(() =>
    resolveDefaultScope(selectedAccountId, selectedAccount)
  );

  // Sync active scope when pinned account changes
  useEffect(() => {
    setActiveScope(resolveDefaultScope(selectedAccountId, selectedAccount));
  }, [selectedAccountId, selectedAccount]);

  // Archetypes state
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [newArchetypeTitle, setNewArchetypeTitle] = useState("");
  const [loadingArchetypes, setLoadingArchetypes] = useState(false);
  const [savingArchetypes, setSavingArchetypes] = useState(false);
  const [archetypesDirty, setArchetypesDirty] = useState(false);

  // Baits state
  const [baits, setBaits] = useState<Bait[]>([]);
  const [newBaitBody, setNewBaitBody] = useState("");
  const [loadingBaits, setLoadingBaits] = useState(false);
  const [savingBaits, setSavingBaits] = useState(false);
  const [baitsDirty, setBaitsDirty] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadData = useCallback(async (scope: ContentScope) => {
    setLoadingArchetypes(true);
    setLoadingBaits(true);
    setArchetypesDirty(false);
    setBaitsDirty(false);
    try {
      const [loadedArchetypes, loadedBaits] = await Promise.all([
        getArchetypes(scope),
        getBaits(scope),
      ]);
      setArchetypes(loadedArchetypes);
      setBaits(loadedBaits);
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Erro ao carregar dados da biblioteca de textos",
      });
    } finally {
      setLoadingArchetypes(false);
      setLoadingBaits(false);
    }
  }, []);

  useEffect(() => {
    void loadData(activeScope);
  }, [activeScope, loadData]);

  // Archetype actions
  const handleAddArchetype = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newArchetypeTitle.trim();
    if (!title) return;

    const newItem: Archetype = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      scope: activeScope,
      title,
      sort_order: archetypes.length,
      active: true,
    };

    setArchetypes([...archetypes, newItem]);
    setNewArchetypeTitle("");
    setArchetypesDirty(true);
  };

  const handleUpdateArchetypeTitle = (index: number, title: string) => {
    const updated = [...archetypes];
    updated[index] = { ...updated[index], title };
    setArchetypes(updated);
    setArchetypesDirty(true);
  };

  const handleToggleArchetypeActive = (index: number) => {
    const updated = [...archetypes];
    updated[index] = { ...updated[index], active: !updated[index].active };
    setArchetypes(updated);
    setArchetypesDirty(true);
  };

  const handleRemoveArchetype = (index: number) => {
    const updated = archetypes.filter((_, i) => i !== index);
    setArchetypes(updated);
    setArchetypesDirty(true);
  };

  const handleMoveArchetype = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= archetypes.length) return;

    const updated = [...archetypes];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    setArchetypes(updated);
    setArchetypesDirty(true);
  };

  const handleSaveArchetypes = async () => {
    setSavingArchetypes(true);
    setFeedback(null);
    try {
      const items: ArchetypeInputItem[] = archetypes.map((arch, idx) => ({
        id: arch.id.startsWith("temp-") ? undefined : arch.id,
        title: arch.title.trim(),
        sort_order: idx,
        active: arch.active,
      }));

      const saved = await putArchetypes(activeScope, items);
      setArchetypes(saved);
      setArchetypesDirty(false);
      setFeedback({
        type: "success",
        message: `Arquétipos do escopo "${SCOPE_LABELS[activeScope]}" salvos com sucesso!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao salvar arquétipos",
      });
    } finally {
      setSavingArchetypes(false);
    }
  };

  // Bait actions
  const handleAddBait = (e: React.FormEvent) => {
    e.preventDefault();
    const body = newBaitBody.trim();
    if (!body) return;

    const newItem: Bait = {
      id: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      scope: activeScope,
      body,
      sort_order: baits.length,
      active: true,
    };

    setBaits([...baits, newItem]);
    setNewBaitBody("");
    setBaitsDirty(true);
  };

  const handleUpdateBaitBody = (index: number, body: string) => {
    const updated = [...baits];
    updated[index] = { ...updated[index], body };
    setBaits(updated);
    setBaitsDirty(true);
  };

  const handleToggleBaitActive = (index: number) => {
    const updated = [...baits];
    updated[index] = { ...updated[index], active: !updated[index].active };
    setBaits(updated);
    setBaitsDirty(true);
  };

  const handleRemoveBait = (index: number) => {
    const updated = baits.filter((_, i) => i !== index);
    setBaits(updated);
    setBaitsDirty(true);
  };

  const handleMoveBait = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= baits.length) return;

    const updated = [...baits];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    setBaits(updated);
    setBaitsDirty(true);
  };

  const handleSaveBaits = async () => {
    setSavingBaits(true);
    setFeedback(null);
    try {
      const items: BaitInputItem[] = baits.map((b, idx) => ({
        id: b.id.startsWith("temp-") ? undefined : b.id,
        body: b.body.trim(),
        sort_order: idx,
        active: b.active,
      }));

      const saved = await putBaits(activeScope, items);
      setBaits(saved);
      setBaitsDirty(false);
      setFeedback({
        type: "success",
        message: `Ganchos do escopo "${SCOPE_LABELS[activeScope]}" salvos com sucesso!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Erro ao salvar ganchos",
      });
    } finally {
      setSavingBaits(false);
    }
  };

  return (
    <div className="settings-page texts-page">
      <div className="page-section-header">
        <div>
          <h3>Biblioteca de Textos & Ganchos</h3>
          <p className="section-description">
            Gerencie arquétipos de temas e ganchos (baits) por escopo de persona
            ou compartilhados (shared).
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`alert-banner ${
            feedback.type === "success" ? "alert-success" : "error-banner"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setFeedback(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Scope navigation tabs */}
      <div className="scope-tabs-container">
        <label className="scope-label">Escopo de Conteúdo:</label>
        <div className="scope-tabs" role="tablist">
          {CONTENT_SCOPES.map((scope) => {
            const isActive = activeScope === scope;
            const isPinnedDefault =
              selectedAccountId !== "all" && selectedAccount?.role === scope;

            return (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`scope-tab ${isActive ? "active" : ""}`}
                onClick={() => setActiveScope(scope)}
              >
                <span>{SCOPE_LABELS[scope]}</span>
                {isPinnedDefault && (
                  <span className="scope-pinned-tag" title="Role da conta em foco">
                    pinned
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="texts-sections-grid">
        {/* Archetypes Section */}
        <section className="text-section-card">
          <div className="section-card-header">
            <div>
              <h4>Arquétipos ({archetypes.length})</h4>
              <span className="card-sub">
                Títulos e ângulos conceituais para os carrosséis
              </span>
            </div>
            <div className="card-header-actions">
              {archetypesDirty && (
                <span className="dirty-indicator">Alterações não salvas</span>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSaveArchetypes()}
                disabled={savingArchetypes || !archetypesDirty}
              >
                {savingArchetypes ? "Salvando..." : "Salvar Arquétipos"}
              </button>
            </div>
          </div>

          <form onSubmit={handleAddArchetype} className="add-item-form">
            <input
              type="text"
              placeholder="Adicionar novo arquétipo..."
              value={newArchetypeTitle}
              onChange={(e) => setNewArchetypeTitle(e.target.value)}
              disabled={loadingArchetypes || savingArchetypes}
            />
            <button
              type="submit"
              className="btn btn-outline btn-sm"
              disabled={!newArchetypeTitle.trim() || savingArchetypes}
            >
              + Adicionar
            </button>
          </form>

          {loadingArchetypes ? (
            <div className="loading-indicator">Carregando arquétipos...</div>
          ) : archetypes.length === 0 ? (
            <div className="empty-state">
              Nenhum arquétipo configurado neste escopo.
            </div>
          ) : (
            <ul className="text-items-list">
              {archetypes.map((arch, index) => (
                <li
                  key={arch.id}
                  className={`text-item-row ${!arch.active ? "item-inactive" : ""}`}
                >
                  <span className="item-order-badge">#{index + 1}</span>
                  <input
                    type="text"
                    className="item-input"
                    value={arch.title}
                    onChange={(e) =>
                      handleUpdateArchetypeTitle(index, e.target.value)
                    }
                  />
                  <div className="item-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Mover para cima"
                      disabled={index === 0}
                      onClick={() => handleMoveArchetype(index, "up")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Mover para baixo"
                      disabled={index === archetypes.length - 1}
                      onClick={() => handleMoveArchetype(index, "down")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`btn-tag ${arch.active ? "tag-active" : "tag-inactive"}`}
                      onClick={() => handleToggleArchetypeActive(index)}
                      title="Alternar ativo/inativo"
                    >
                      {arch.active ? "Ativo" : "Inativo"}
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Remover"
                      onClick={() => handleRemoveArchetype(index)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Baits Section */}
        <section className="text-section-card">
          <div className="section-card-header">
            <div>
              <h4>Ganchos / Baits ({baits.length})</h4>
              <span className="card-sub">
                Frases de chamada inicial nos slides
              </span>
            </div>
            <div className="card-header-actions">
              {baitsDirty && (
                <span className="dirty-indicator">Alterações não salvas</span>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSaveBaits()}
                disabled={savingBaits || !baitsDirty}
              >
                {savingBaits ? "Salvando..." : "Salvar Ganchos"}
              </button>
            </div>
          </div>

          <form onSubmit={handleAddBait} className="add-item-form">
            <input
              type="text"
              placeholder="Adicionar novo gancho (bait)..."
              value={newBaitBody}
              onChange={(e) => setNewBaitBody(e.target.value)}
              disabled={loadingBaits || savingBaits}
            />
            <button
              type="submit"
              className="btn btn-outline btn-sm"
              disabled={!newBaitBody.trim() || savingBaits}
            >
              + Adicionar
            </button>
          </form>

          {loadingBaits ? (
            <div className="loading-indicator">Carregando ganchos...</div>
          ) : baits.length === 0 ? (
            <div className="empty-state">
              Nenhum gancho configurado neste escopo.
            </div>
          ) : (
            <ul className="text-items-list">
              {baits.map((bait, index) => (
                <li
                  key={bait.id}
                  className={`text-item-row ${!bait.active ? "item-inactive" : ""}`}
                >
                  <span className="item-order-badge">#{index + 1}</span>
                  <input
                    type="text"
                    className="item-input"
                    value={bait.body}
                    onChange={(e) =>
                      handleUpdateBaitBody(index, e.target.value)
                    }
                  />
                  <div className="item-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Mover para cima"
                      disabled={index === 0}
                      onClick={() => handleMoveBait(index, "up")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      title="Mover para baixo"
                      disabled={index === baits.length - 1}
                      onClick={() => handleMoveBait(index, "down")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`btn-tag ${bait.active ? "tag-active" : "tag-inactive"}`}
                      onClick={() => handleToggleBaitActive(index)}
                      title="Alternar ativo/inativo"
                    >
                      {bait.active ? "Ativo" : "Inativo"}
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Remover"
                      onClick={() => handleRemoveBait(index)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
