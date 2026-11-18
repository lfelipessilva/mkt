import React, { useState } from "react";
import { useAccount } from "../../context";
import {
  ACCOUNT_ROLES,
  ROLE_LABELS,
  validateAccountInput,
  getBufferLinkageStatus,
  type Account,
  type AccountRole,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "../../types";
import {
  createAccount,
  updateAccount,
  deleteAccount,
  syncSocialAccounts,
} from "../../api";
import { Eye, EyeOff, RefreshCw, UserPlus, Users } from "lucide-react";
import {
  Button,
  CheckboxField,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  RoleBadge,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
  cn,
} from "../../ui";

interface AccountFormState {
  id: string;
  display_name: string;
  role: AccountRole;
  persona: string;
  enabled: boolean;
  auto_post_enabled: boolean;
  tiktok_open_id: string;
  external_account_id: string;
  social_provider: string;
  zernio_api_key: string;
}

const emptyFormState: AccountFormState = {
  id: "",
  display_name: "",
  role: "single_woman",
  persona: "",
  enabled: true,
  auto_post_enabled: true,
  tiktok_open_id: "",
  external_account_id: "",
  social_provider: "zernio",
  zernio_api_key: "",
};

function StatusToggle({
  active,
  disabled,
  onClick,
  title,
  testId,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  testId?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200",
        disabled && "pointer-events-none opacity-50"
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
    >
      {active ? "Ativo" : "Inativo"}
    </button>
  );
}

interface AccountFormProps {
  formId: string;
  form: AccountFormState;
  setForm: React.Dispatch<React.SetStateAction<AccountFormState>>;
  formError: string | null;
  actionLoading: boolean;
  showId: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitLabel: string;
}

function AccountForm({
  formId,
  form,
  setForm,
  formError,
  actionLoading,
  showId,
  onSubmit,
  onCancel,
  submitLabel,
}: AccountFormProps): React.JSX.Element {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      <form
        id={formId}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {formError && <InlineAlert tone="error">{formError}</InlineAlert>}

        {showId && (
          <Field
            label="ID da Conta (sem @)"
            htmlFor="account-id"
            hint="Identificador único no sistema"
            required
          >
            <Input
              id="account-id"
              type="text"
              placeholder="ex: lucas_silva"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              required
            />
          </Field>
        )}

        <Field label="Nome de Exibição" htmlFor="account-name">
          <Input
            id="account-name"
            type="text"
            placeholder="ex: Lucas Silva"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
        </Field>

        <Field label="Role (Papel de Conteúdo)" htmlFor="account-role" required>
          <Select
            id="account-role"
            value={form.role}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value as AccountRole })
            }
          >
            {ACCOUNT_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]} ({role})
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Persona (Diretriz de Tom)"
          htmlFor="account-persona"
          required
        >
          <Textarea
            id="account-persona"
            rows={4}
            placeholder="Descreva o tom, gírias e posicionamento desta persona..."
            value={form.persona}
            onChange={(e) => setForm({ ...form, persona: e.target.value })}
            required
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="TikTok Open ID (opcional)" htmlFor="account-tiktok">
            <Input
              id="account-tiktok"
              type="text"
              placeholder="ID da conta no TikTok"
              value={form.tiktok_open_id}
              onChange={(e) =>
                setForm({ ...form, tiktok_open_id: e.target.value })
              }
            />
          </Field>

          <Field
            label="ID da conta Zernio"
            htmlFor="account-buffer"
            hint={`Provider: ${form.social_provider || "zernio"}`}
          >
            <Input
              id="account-buffer"
              type="text"
              placeholder="external_account_id"
              value={form.external_account_id}
              onChange={(e) =>
                setForm({ ...form, external_account_id: e.target.value })
              }
            />
          </Field>
        </div>

        <Field
          label="Chave API Zernio (opcional)"
          htmlFor="account-zernio-api-key"
          hint="Se vazio, usa a chave padrão do sistema (ZERNIO_API_KEY do .env)."
        >
          <div className="relative">
            <Input
              id="account-zernio-api-key"
              type={showApiKey ? "text" : "password"}
              placeholder="zk_..."
              value={form.zernio_api_key}
              onChange={(e) =>
                setForm({ ...form, zernio_api_key: e.target.value })
              }
              className="pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 focus:outline-none"
              title={showApiKey ? "Ocultar chave API" : "Exibir chave API"}
              aria-label={showApiKey ? "Ocultar chave API" : "Exibir chave API"}
            >
              {showApiKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </Field>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <CheckboxField
            label="Habilitar esta conta para gerações automáticas"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          <CheckboxField
            label="Habilitar auto-post na rotina de agendamento diária"
            checked={form.auto_post_enabled}
            onChange={(e) =>
              setForm({ ...form, auto_post_enabled: e.target.checked })
            }
            data-testid={`${showId ? "create" : "edit"}-acc-auto-post`}
          />
        </div>
      </form>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="outline" onClick={onCancel} disabled={actionLoading}>
          Cancelar
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          isLoading={actionLoading}
        >
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

export function AccountsPage(): React.JSX.Element {
  const { accounts, loading, error, reloadAccounts } = useAccount();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<AccountFormState>(emptyFormState);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountFormState>(emptyFormState);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncingBuffer, setSyncingBuffer] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setCreateForm(emptyFormState);
    setFormError(null);
    setShowCreateModal(true);
  };

  const handleStartEdit = (acc: Account) => {
    setEditingAccount(acc);
    setEditForm({
      id: acc.id,
      display_name: acc.display_name || "",
      role: acc.role,
      persona: acc.persona || "",
      enabled: acc.enabled,
      auto_post_enabled: acc.auto_post_enabled !== false,
      tiktok_open_id: acc.tiktok_open_id || "",
      external_account_id: acc.external_account_id || "",
      social_provider: acc.social_provider || "zernio",
      zernio_api_key: acc.zernio_api_key || "",
    });
    setFormError(null);
  };

  const handleSyncBuffer = async () => {
    setSyncingBuffer(true);
    setStatusMessage(null);
    try {
      const res = await syncSocialAccounts();
      await reloadAccounts();
      const failureNote =
        res.errors && res.errors.length > 0
          ? ` Avisos: ${res.errors.join("; ")}`
          : "";
      setStatusMessage(
        `Sincronização Zernio concluída: ${res.synced} canal(is) encontrado(s), ${res.matched} vinculado(s), ${res.created} importado(s).${failureNote}`
      );
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Erro ao sincronizar contas do Zernio"
      );
    } finally {
      setSyncingBuffer(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validateAccountInput({
      id: createForm.id,
      role: createForm.role,
      persona: createForm.persona,
      enabled: createForm.enabled,
    });

    if (!validation.valid) {
      setFormError(validation.error || "Dados inválidos");
      return;
    }

    setActionLoading(true);
    try {
      const payload: CreateAccountInput = {
        id: createForm.id.trim(),
        role: createForm.role,
        persona: createForm.persona.trim(),
        enabled: createForm.enabled,
        auto_post_enabled: createForm.auto_post_enabled,
        display_name: createForm.display_name.trim() || null,
        tiktok_open_id: createForm.tiktok_open_id.trim() || null,
        external_account_id: createForm.external_account_id.trim() || null,
        social_provider: createForm.social_provider.trim() || null,
        zernio_api_key: createForm.zernio_api_key ? createForm.zernio_api_key.trim() : null,
      };

      await createAccount(payload);
      await reloadAccounts();
      setShowCreateModal(false);
      setCreateForm(emptyFormState);
      setStatusMessage(`Conta @${payload.id} criada com sucesso!`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao criar conta");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setFormError(null);

    setActionLoading(true);
    try {
      const payload: UpdateAccountInput = {
        role: editForm.role,
        persona: editForm.persona.trim(),
        enabled: editForm.enabled,
        auto_post_enabled: editForm.auto_post_enabled,
        display_name: editForm.display_name.trim() || null,
        tiktok_open_id: editForm.tiktok_open_id.trim() || null,
        external_account_id: editForm.external_account_id.trim() || null,
        social_provider: editForm.social_provider.trim() || null,
        zernio_api_key: editForm.zernio_api_key ? editForm.zernio_api_key.trim() : null,
      };

      await updateAccount(editingAccount.id, payload);
      await reloadAccounts();
      setEditingAccount(null);
      setStatusMessage(`Conta @${editingAccount.id} atualizada com sucesso!`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao atualizar conta");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleAutoPost = async (acc: Account) => {
    setActionLoading(true);
    try {
      const nextVal = acc.auto_post_enabled === false ? true : false;
      await updateAccount(acc.id, { auto_post_enabled: nextVal });
      await reloadAccounts();
      setStatusMessage(
        `Auto-post da conta @${acc.id} ${nextVal ? "ativado" : "desativado"}`
      );
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Erro ao alterar status de auto-post"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading(true);
    try {
      await deleteAccount(id);
      await reloadAccounts();
      setDeleteConfirmId(null);
      setStatusMessage(`Conta @${id} excluída com sucesso!`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao excluir conta");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleEnabled = async (acc: Account) => {
    setActionLoading(true);
    try {
      await updateAccount(acc.id, { enabled: !acc.enabled });
      await reloadAccounts();
      setStatusMessage(
        `Conta @${acc.id} ${!acc.enabled ? "ativada" : "desativada"}`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao alterar status");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Contas de Personas"
        description="Gerencie as contas ativas, atribua perfis de persona e configure os 4 papéis (roles) para geração direcionada."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void handleSyncBuffer()}
              disabled={actionLoading || syncingBuffer}
              data-testid="btn-sync-buffer"
            >
              <RefreshCw
                className={
                  syncingBuffer
                    ? "h-4 w-4 animate-spin text-blue-600"
                    : "h-4 w-4"
                }
              />
              <span>
                {syncingBuffer ? "Puxando do Zernio..." : "Puxar contas do Zernio"}
              </span>
            </Button>
            <Button
              variant="primary"
              onClick={handleOpenCreate}
              data-testid="btn-add-account"
            >
              <UserPlus className="h-4 w-4" />
              <span>Adicionar Conta</span>
            </Button>
          </>
        }
      />

      {statusMessage && (
        <InlineAlert tone="success" onClose={() => setStatusMessage(null)}>
          {statusMessage}
        </InlineAlert>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {loading && accounts.length === 0 ? (
        <LoadingState label="Carregando contas..." />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Nenhuma conta cadastrada ainda"
          description="Cadastre a primeira conta para começar a gerar carrosséis."
          action={
            <Button variant="outline" size="sm" onClick={handleOpenCreate}>
              Cadastrar primeira conta
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow className="hover:bg-transparent">
              <TableHeaderCell>Conta / ID</TableHeaderCell>
              <TableHeaderCell>Nome de Exibição</TableHeaderCell>
              <TableHeaderCell>Role (Papel)</TableHeaderCell>
              <TableHeaderCell>Persona</TableHeaderCell>
              <TableHeaderCell>Zernio / Canal</TableHeaderCell>
              <TableHeaderCell>TikTok Open ID</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Auto-Post</TableHeaderCell>
              <TableHeaderCell>Ações</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.map((acc) => {
              const bufferStatus = getBufferLinkageStatus(acc);
              return (
                <TableRow key={acc.id} disabled={!acc.enabled}>
                  <TableCell>
                    <strong className="font-semibold text-blue-700">
                      @{acc.id}
                    </strong>
                  </TableCell>
                  <TableCell>{acc.display_name || "-"}</TableCell>
                  <TableCell>
                    <RoleBadge role={acc.role} label={ROLE_LABELS[acc.role]} />
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <span
                      className="block truncate text-slate-500"
                      title={acc.persona}
                    >
                      {acc.persona
                        ? acc.persona.slice(0, 75) +
                          (acc.persona.length > 75 ? "..." : "")
                        : "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {bufferStatus.isLinked ? (
                      <span
                        className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                        title={`Zernio ID: ${bufferStatus.externalAccountId}`}
                      >
                        Zernio ({bufferStatus.externalAccountId})
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Não vinculado</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      {acc.tiktok_open_id ? acc.tiktok_open_id : "não vinculado"}
                    </code>
                  </TableCell>
                  <TableCell>
                    <StatusToggle
                      active={acc.enabled}
                      disabled={actionLoading}
                      onClick={() => void handleToggleEnabled(acc)}
                      title="Clique para alternar ativo/inativo"
                    />
                  </TableCell>
                  <TableCell>
                    <StatusToggle
                      active={acc.auto_post_enabled !== false}
                      disabled={actionLoading}
                      onClick={() => void handleToggleAutoPost(acc)}
                      title="Clique para alternar auto-post ativo/inativo"
                      testId={`toggle-auto-post-${acc.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEdit(acc)}
                        disabled={actionLoading}
                      >
                        Editar
                      </Button>
                      {deleteConfirmId === acc.id ? (
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void handleDelete(acc.id)}
                            disabled={actionLoading}
                          >
                            Confirmar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Cancelar
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="danger-outline"
                          size="sm"
                          onClick={() => setDeleteConfirmId(acc.id)}
                          disabled={actionLoading}
                        >
                          Excluir
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Adicionar Nova Conta"
        subtitle="Configure a persona e os canais de publicação."
        size="md"
        bodyClassName="px-0 py-0"
      >
        <div className="px-5 py-5">
          <AccountForm
            formId="create-account-form"
            form={createForm}
            setForm={setCreateForm}
            formError={formError}
            actionLoading={actionLoading}
            showId
            onSubmit={(e) => void handleCreateSubmit(e)}
            onCancel={() => setShowCreateModal(false)}
            submitLabel={actionLoading ? "Salvando..." : "Criar Conta"}
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(editingAccount)}
        onClose={() => setEditingAccount(null)}
        title={`Editar Conta: @${editingAccount?.id ?? ""}`}
        subtitle="Atualize a persona, vínculos e regras de publicação."
        size="md"
        bodyClassName="px-0 py-0"
      >
        <div className="px-5 py-5">
          <AccountForm
            formId="edit-account-form"
            form={editForm}
            setForm={setEditForm}
            formError={formError}
            actionLoading={actionLoading}
            showId={false}
            onSubmit={(e) => void handleEditSubmit(e)}
            onCancel={() => setEditingAccount(null)}
            submitLabel={actionLoading ? "Salvando..." : "Salvar Alterações"}
          />
        </div>
      </Modal>
    </div>
  );
}
