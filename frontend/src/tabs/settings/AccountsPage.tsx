import React, { useState } from "react";
import { useAccount } from "../../context";
import {
  ACCOUNT_ROLES,
  ROLE_LABELS,
  validateAccountInput,
  type Account,
  type AccountRole,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "../../types";
import { createAccount, updateAccount, deleteAccount } from "../../api";

interface AccountFormState {
  id: string;
  display_name: string;
  role: AccountRole;
  persona: string;
  enabled: boolean;
  tiktok_open_id: string;
}

const emptyFormState: AccountFormState = {
  id: "",
  display_name: "",
  role: "single_woman",
  persona: "",
  enabled: true,
  tiktok_open_id: "",
};

export function AccountsPage(): React.JSX.Element {
  const { accounts, loading, error, reloadAccounts } = useAccount();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<AccountFormState>(emptyFormState);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountFormState>(emptyFormState);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
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
      tiktok_open_id: acc.tiktok_open_id || "",
    });
    setFormError(null);
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
        display_name: createForm.display_name.trim() || null,
        tiktok_open_id: createForm.tiktok_open_id.trim() || null,
      };

      await createAccount(payload);
      await reloadAccounts();
      setShowCreateModal(false);
      setCreateForm(emptyFormState);
      setStatusMessage(`Conta @${payload.id} criada com sucesso!`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao criar conta"
      );
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
        display_name: editForm.display_name.trim() || null,
        tiktok_open_id: editForm.tiktok_open_id.trim() || null,
      };

      await updateAccount(editingAccount.id, payload);
      await reloadAccounts();
      setEditingAccount(null);
      setStatusMessage(`Conta @${editingAccount.id} atualizada com sucesso!`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao atualizar conta"
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
    <div className="settings-page accounts-page">
      <div className="page-section-header">
        <div>
          <h3>Contas de Personas</h3>
          <p className="section-description">
            Gerencie as contas ativas, atribua perfis de persona e configure os 4
            papéis (roles) para geração direcionada.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleOpenCreate}
          data-testid="btn-add-account"
        >
          + Adicionar Conta
        </button>
      </div>

      {statusMessage && (
        <div className="alert-banner alert-success">
          <span>{statusMessage}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setStatusMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {loading && accounts.length === 0 ? (
        <div className="loading-indicator">Carregando contas...</div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma conta cadastrada ainda.</p>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleOpenCreate}
          >
            Cadastrar primeira conta
          </button>
        </div>
      ) : (
        <div className="accounts-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Conta / ID</th>
                <th>Nome de Exibição</th>
                <th>Role (Papel)</th>
                <th>Persona</th>
                <th>TikTok Open ID</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id} className={!acc.enabled ? "row-disabled" : ""}>
                  <td className="account-id-cell">
                    <strong>@{acc.id}</strong>
                  </td>
                  <td>{acc.display_name || "-"}</td>
                  <td>
                    <span className={`role-badge role-${acc.role}`}>
                      {ROLE_LABELS[acc.role]}
                    </span>
                  </td>
                  <td className="persona-cell">
                    <span className="persona-text" title={acc.persona}>
                      {acc.persona ? acc.persona.slice(0, 75) + (acc.persona.length > 75 ? "..." : "") : "-"}
                    </span>
                  </td>
                  <td>
                    <span className="code-snippet">
                      {acc.tiktok_open_id ? acc.tiktok_open_id : "não vinculado"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`status-toggle ${acc.enabled ? "active" : "inactive"}`}
                      onClick={() => void handleToggleEnabled(acc)}
                      disabled={actionLoading}
                      title="Clique para alternar ativo/inativo"
                    >
                      {acc.enabled ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => handleStartEdit(acc)}
                      disabled={actionLoading}
                    >
                      Editar
                    </button>
                    {deleteConfirmId === acc.id ? (
                      <span className="confirm-delete-actions">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => void handleDelete(acc.id)}
                          disabled={actionLoading}
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger-outline btn-sm"
                        onClick={() => setDeleteConfirmId(acc.id)}
                        disabled={actionLoading}
                      >
                        Excluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal / Overlay para Criar Conta */}
      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h4>Adicionar Nova Conta</h4>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateSubmit(e)} className="modal-form">
              {formError && <div className="error-banner">{formError}</div>}

              <div className="form-group">
                <label htmlFor="create-acc-id">ID da Conta (sem @)*</label>
                <input
                  id="create-acc-id"
                  type="text"
                  placeholder="ex: lucas_silva"
                  value={createForm.id}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, id: e.target.value })
                  }
                  required
                />
                <span className="form-hint">Identificador único no sistema</span>
              </div>

              <div className="form-group">
                <label htmlFor="create-acc-name">Nome de Exibição</label>
                <input
                  id="create-acc-name"
                  type="text"
                  placeholder="ex: Lucas Silva"
                  value={createForm.display_name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, display_name: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-acc-role">Role (Papel de Conteúdo)*</label>
                <select
                  id="create-acc-role"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      role: e.target.value as AccountRole,
                    })
                  }
                >
                  {ACCOUNT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]} ({role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="create-acc-persona">Persona (Diretriz de Tom)*</label>
                <textarea
                  id="create-acc-persona"
                  rows={4}
                  placeholder="Descreva o tom, gírias e posicionamento desta persona..."
                  value={createForm.persona}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, persona: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-acc-tiktok">TikTok Open ID (opcional)</label>
                <input
                  id="create-acc-tiktok"
                  type="text"
                  placeholder="ID da conta no TikTok para postagens"
                  value={createForm.tiktok_open_id}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, tiktok_open_id: e.target.value })
                  }
                />
              </div>

              <div className="form-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={createForm.enabled}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, enabled: e.target.checked })
                    }
                  />
                  Habilitar esta conta para gerações automáticas
                </label>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCreateModal(false)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? "Salvando..." : "Criar Conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal / Overlay para Editar Conta */}
      {editingAccount && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h4>Editar Conta: @{editingAccount.id}</h4>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setEditingAccount(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleEditSubmit(e)} className="modal-form">
              {formError && <div className="error-banner">{formError}</div>}

              <div className="form-group">
                <label htmlFor="edit-acc-name">Nome de Exibição</label>
                <input
                  id="edit-acc-name"
                  type="text"
                  value={editForm.display_name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, display_name: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-acc-role">Role (Papel de Conteúdo)*</label>
                <select
                  id="edit-acc-role"
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      role: e.target.value as AccountRole,
                    })
                  }
                >
                  {ACCOUNT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]} ({role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="edit-acc-persona">Persona (Diretriz de Tom)*</label>
                <textarea
                  id="edit-acc-persona"
                  rows={4}
                  value={editForm.persona}
                  onChange={(e) =>
                    setEditForm({ ...editForm, persona: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-acc-tiktok">TikTok Open ID</label>
                <input
                  id="edit-acc-tiktok"
                  type="text"
                  value={editForm.tiktok_open_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, tiktok_open_id: e.target.value })
                  }
                />
              </div>

              <div className="form-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={editForm.enabled}
                    onChange={(e) =>
                      setEditForm({ ...editForm, enabled: e.target.checked })
                    }
                  />
                  Habilitar esta conta para gerações automáticas
                </label>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingAccount(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
