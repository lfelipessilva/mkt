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
import { getArchetypes, putArchetypes, getBaits, putBaits } from "../../api";
import { ArrowDown, ArrowUp, FileText, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  InlineAlert,
  Input,
  LoadingState,
  PageHeader,
  ScopeTabs,
  SectionCard,
  cn,
} from "../../ui";

interface TextListPanelProps<T extends { id: string; active: boolean }> {
  title: string;
  description: string;
  emptyMessage: string;
  placeholder: string;
  newValue: string;
  onNewValueChange: (value: string) => void;
  onAdd: (e: React.FormEvent) => void;
  items: T[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  loadingMessage: string;
  saveLabel: string;
  getValue: (item: T) => string;
  onUpdate: (index: number, value: string) => void;
  onToggle: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onSave: () => void;
}

function TextListPanel<T extends { id: string; active: boolean }>({
  title,
  description,
  emptyMessage,
  placeholder,
  newValue,
  onNewValueChange,
  onAdd,
  items,
  loading,
  saving,
  dirty,
  loadingMessage,
  saveLabel,
  getValue,
  onUpdate,
  onToggle,
  onRemove,
  onMove,
  onSave,
}: TextListPanelProps<T>): React.JSX.Element {
  return (
    <SectionCard
      title={`${title} (${items.length})`}
      description={description}
      actions={
        <>
          {dirty && <Badge tone="amber">Alterações não salvas</Badge>}
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={saving || !dirty}
            isLoading={saving}
          >
            {saving ? "Salvando..." : saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <form onSubmit={onAdd} className="flex gap-2">
          <Input
            type="text"
            placeholder={placeholder}
            value={newValue}
            onChange={(e) => onNewValueChange(e.target.value)}
            disabled={loading || saving}
          />
          <Button
            type="submit"
            variant="outline"
            size="md"
            disabled={!newValue.trim() || saving}
          >
            + Adicionar
          </Button>
        </form>

        {loading ? (
          <LoadingState label={loadingMessage} className="py-8" />
        ) : items.length === 0 ? (
          <EmptyState title={emptyMessage} />
        ) : (
          <ul className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-1.5 transition-opacity",
                  !item.active && "opacity-55"
                )}
              >
                <span className="w-6 flex-none text-center text-[11px] font-semibold text-slate-400">
                  #{index + 1}
                </span>
                <Input
                  type="text"
                  className="h-8 flex-1 border-transparent bg-transparent px-2 shadow-none focus:border-blue-500 focus:bg-white"
                  value={getValue(item)}
                  onChange={(e) => onUpdate(index, e.target.value)}
                />
                <div className="flex flex-none items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Mover para cima"
                    disabled={index === 0}
                    onClick={() => onMove(index, "up")}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Mover para baixo"
                    disabled={index === items.length - 1}
                    onClick={() => onMove(index, "down")}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                      item.active
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                    )}
                    onClick={() => onToggle(index)}
                    title="Alternar ativo/inativo"
                  >
                    {item.active ? "Ativo" : "Inativo"}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    title="Remover"
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

export function TextsPage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount } = useAccount();

  const [activeScope, setActiveScope] = useState<ContentScope>(() =>
    resolveDefaultScope(selectedAccountId, selectedAccount)
  );

  useEffect(() => {
    setActiveScope(resolveDefaultScope(selectedAccountId, selectedAccount));
  }, [selectedAccountId, selectedAccount]);

  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [newArchetypeTitle, setNewArchetypeTitle] = useState("");
  const [loadingArchetypes, setLoadingArchetypes] = useState(false);
  const [savingArchetypes, setSavingArchetypes] = useState(false);
  const [archetypesDirty, setArchetypesDirty] = useState(false);

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
        message: err instanceof Error ? err.message : "Erro ao salvar arquétipos",
      });
    } finally {
      setSavingArchetypes(false);
    }
  };

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

  const scopeOptions = CONTENT_SCOPES.map((scope) => ({
    id: scope,
    label: SCOPE_LABELS[scope],
    pinned: selectedAccountId !== "all" && selectedAccount?.role === scope,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title="Biblioteca de Textos & Ganchos"
        description="Gerencie arquétipos de temas e ganchos (baits) por escopo de persona ou compartilhados (shared)."
      />

      {feedback && (
        <InlineAlert
          tone={feedback.type === "success" ? "success" : "error"}
          onClose={() => setFeedback(null)}
        >
          {feedback.message}
        </InlineAlert>
      )}

      <ScopeTabs
        label="Escopo de Conteúdo"
        ariaLabel="Escopo de conteúdo"
        options={scopeOptions}
        value={activeScope}
        onChange={(id) => setActiveScope(id as ContentScope)}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TextListPanel<Archetype>
          title="Arquétipos"
          description="Títulos e ângulos conceituais para os carrosséis"
          emptyMessage="Nenhum arquétipo configurado neste escopo."
          placeholder="Adicionar novo arquétipo..."
          newValue={newArchetypeTitle}
          onNewValueChange={setNewArchetypeTitle}
          onAdd={handleAddArchetype}
          items={archetypes}
          loading={loadingArchetypes}
          loadingMessage="Carregando arquétipos..."
          saving={savingArchetypes}
          dirty={archetypesDirty}
          saveLabel="Salvar Arquétipos"
          getValue={(item) => item.title}
          onUpdate={handleUpdateArchetypeTitle}
          onToggle={handleToggleArchetypeActive}
          onRemove={handleRemoveArchetype}
          onMove={handleMoveArchetype}
          onSave={() => void handleSaveArchetypes()}
        />

        <TextListPanel<Bait>
          title="Ganchos / Baits"
          description="Frases de chamada inicial nos slides"
          emptyMessage="Nenhum gancho configurado neste escopo."
          placeholder="Adicionar novo gancho (bait)..."
          newValue={newBaitBody}
          onNewValueChange={setNewBaitBody}
          onAdd={handleAddBait}
          items={baits}
          loading={loadingBaits}
          loadingMessage="Carregando ganchos..."
          saving={savingBaits}
          dirty={baitsDirty}
          saveLabel="Salvar Ganchos"
          getValue={(item) => item.body}
          onUpdate={handleUpdateBaitBody}
          onToggle={handleToggleBaitActive}
          onRemove={handleRemoveBait}
          onMove={handleMoveBait}
          onSave={() => void handleSaveBaits()}
        />
      </div>
    </div>
  );
}
