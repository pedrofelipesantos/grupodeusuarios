import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const signOutButton = document.querySelector("#sign-out");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const feedbackForm = document.querySelector("#feedback-form");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const feedbackList = document.querySelector("#feedback-list");
const feedbackTemplate = document.querySelector("#feedback-template");
const searchInput = document.querySelector("#search-input");
const outcomeFilter = document.querySelector("#filter-outcome");
const toolFilter = document.querySelector("#filter-tool");
const feedbackCount = document.querySelector("#feed-count");
const ratingInput = document.querySelector("#rating");
const ratingOutput = document.querySelector("#rating-output");
const demoButton = document.querySelector("#demo-button");
const demoBanner = document.querySelector("#demo-banner");
const roleBadge = document.querySelector("#role-badge");
const demoStorageKey = "fieldnotes-demo-local-pt-br";

let supabase;
let currentUser;
let entries = [];
let demoMode = false;
let currentRole = "user";

const sampleEntries = [
  {
    id: "demo-1",
    tool: "Pesquisa de semelhantes",
    title: "O link de redefinição de senha abre uma página expirada",
    category: "Bug",
    outcome: "Failed",
    severity: "High",
    details: "Solicitei a redefinição de senha e recebi o e-mail, mas o link abriu uma mensagem informando que a página expirou.",
    expected: "O link deveria abrir o formulário de redefinição de senha.",
    steps: "1. Selecione \"Esqueci minha senha\". 2. Solicite a redefinição. 3. Abra o link recebido por e-mail.",
    suggestion: "",
    rating: 2,
    author: "Alex",
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "demo-2",
    tool: "Agrupamento de processos",
    title: "A busca facilita encontrar um relatório salvo",
    category: "Positive",
    outcome: "Passed",
    severity: "Low",
    details: "A busca pelo nome do relatório encontrou o resultado certo imediatamente. Foi fácil localizar o botão para limpar a busca.",
    expected: "",
    steps: "",
    suggestion: "",
    rating: 5,
    author: "Sam",
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "demo-3",
    tool: "Assistente de minuta do Logos",
    title: "Não ficou claro se as alterações foram salvas",
    category: "Usability",
    outcome: "Idea",
    severity: "Medium",
    details: "Depois de alterar meu nome de exibição, a página não confirmou a operação e fiquei sem saber se a atualização funcionou.",
    expected: "Uma confirmação breve de salvamento deixaria o resultado claro.",
    steps: "",
    suggestion: "Exibir uma mensagem de confirmação após salvar as alterações do perfil.",
    rating: 3,
    author: "Jordan",
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error-message", isError);
}

function explainError(error) {
  const message = error?.message ?? String(error);
  const lowerMessage = message.toLocaleLowerCase();
  if (lowerMessage.includes("email rate limit exceeded")) {
    return "O limite de envio de e-mails foi atingido. Aguarde antes de solicitar outro link ou configure um serviço SMTP no Supabase.";
  }
  if (lowerMessage.includes("invalid path specified")) {
    return "O Supabase recebeu um endereço inválido. Confira se a URL do projeto em config.js termina em .supabase.co e não inclui /rest/v1.";
  }
  if (lowerMessage.includes("otp_disabled") || lowerMessage.includes("signups not allowed for otp")) {
    return "O acesso por link de e-mail está desativado no Supabase. Verifique as configurações de autenticação por e-mail.";
  }
  if (lowerMessage.includes("redirect") && lowerMessage.includes("allow")) {
    return "O endereço deste aplicativo não está permitido para redirecionamento. Adicione-o em Authentication → URL Configuration no Supabase.";
  }
  return `O serviço retornou um erro: ${message}`;
}

const categoryLabels = {
  Suggestion: "Sugestão",
  Bug: "Problema",
  Usability: "Usabilidade",
  Performance: "Desempenho",
  Access: "Acesso",
  Positive: "Ponto positivo",
  Other: "Outro",
};
const outcomeLabels = {
  Failed: "Não funcionou",
  Passed: "Funcionou como esperado",
  Partial: "Funcionou parcialmente como esperado",
  Blocked: "Não foi possível concluir",
  Idea: "Sugestão",
};
const severityLabels = {
  Low: "Baixo",
  Medium: "Médio",
  High: "Alto",
  Blocker: "Bloqueador",
};

function setSignedIn(isSignedIn) {
  authView.classList.toggle("hidden", isSignedIn);
  appView.classList.toggle("hidden", !isSignedIn);
  signOutButton.classList.toggle("hidden", !isSignedIn);
  demoBanner.classList.toggle("hidden", !isSignedIn || !demoMode);
  roleBadge.classList.toggle("hidden", !isSignedIn);
  roleBadge.textContent = demoMode ? "Demonstração local" : currentRole === "admin" ? "Administrador" : "Usuário";
}

function loadDemoEntries() {
  try {
    const savedEntries = localStorage.getItem(demoStorageKey);
    return savedEntries
      ? JSON.parse(savedEntries).map((entry) => ({
        ...entry,
        tool: entry.tool ?? "Pesquisa de semelhantes",
        demoOwner: entry.demoOwner ?? false,
      }))
      : structuredClone(sampleEntries);
  } catch (error) {
    showMessage(loginMessage, `Não foi possível carregar os dados da demonstração: ${error.message}`, true);
    return structuredClone(sampleEntries);
  }
}

function saveDemoEntries() {
  try {
    localStorage.setItem(demoStorageKey, JSON.stringify(entries));
    return true;
  } catch (error) {
    showMessage(formMessage, `Não foi possível salvar este relato neste navegador: ${error.message}`, true);
    return false;
  }
}

function startDemo() {
  demoMode = true;
  currentUser = null;
  currentRole = "user";
  entries = loadDemoEntries();
  searchInput.value = "";
  outcomeFilter.value = "";
  setSignedIn(true);
  updateSummary();
  renderEntries();
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(dateValue));
}

function appendTag(container, label, className) {
  const tag = document.createElement("span");
  tag.className = `tag ${className}`;
  tag.textContent = label;
  container.append(tag);
}

function renderEntries() {
  const query = searchInput.value.trim().toLocaleLowerCase("pt-BR");
  const outcome = outcomeFilter.value;
  const tool = toolFilter.value;
  const filtered = entries.filter((entry) => {
    const searchable = [
      entry.tool,
      entry.title,
      categoryLabels[entry.category] ?? entry.category,
      outcomeLabels[entry.outcome] ?? entry.outcome,
      severityLabels[entry.severity] ?? entry.severity,
      entry.details,
      entry.expected,
      entry.steps,
      entry.suggestion,
      entry.author,
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    return (!query || searchable.includes(query))
      && (!outcome || entry.outcome === outcome)
      && (!tool || entry.tool === tool);
  });

  feedbackList.replaceChildren();
  feedbackCount.textContent = String(filtered.length);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "empty-icon";
    icon.innerHTML = entries.length
      ? '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M9 13h6M9 16.5h4"/></svg>';
    const title = document.createElement("h3");
    title.textContent = entries.length ? "Nenhum relato encontrado" : "O registro da equipe começa aqui";
    const message = document.createElement("p");
    message.textContent = entries.length
      ? "Tente outra busca ou altere os filtros de resultado e ferramenta."
      : "Quando alguém da equipe compartilhar uma experiência, ela aparecerá aqui.";
    empty.append(icon, title, message);
    feedbackList.append(empty);
    return;
  }

  for (const entry of filtered) {
    const card = feedbackTemplate.content.firstElementChild.cloneNode(true);
    const tags = card.querySelector(".tag-row");
    const outcomeClass = entry.outcome.toLowerCase();
    const severityClass = entry.severity.toLowerCase();
    appendTag(tags, outcomeLabels[entry.outcome] ?? entry.outcome, `outcome-${outcomeClass}`);
    appendTag(tags, severityLabels[entry.severity] ?? entry.severity, `severity-${severityClass}`);
    card.querySelector("time").textContent = formatDate(entry.created_at);
    card.querySelector("time").dateTime = entry.created_at;
    card.querySelector("h3").textContent = entry.title;
    card.querySelector(".feedback-tool").textContent = entry.tool ?? "";
    card.querySelector(".feedback-details").textContent = entry.details;
    const deleteButton = card.querySelector(".delete-entry");
    const canDelete = demoMode
      ? entry.demoOwner === true
      : entry.user_id === currentUser?.id || currentRole === "admin";
    deleteButton.classList.toggle("hidden", !canDelete);
    deleteButton.setAttribute("aria-label", `Excluir relato: ${entry.title}`);
    deleteButton.addEventListener("click", () => void deleteEntry(entry));

    const extra = card.querySelector(".feedback-extra");
    for (const [label, value] of [["Esperado", entry.expected], ["Etapas", entry.steps], ["Sugestão", entry.suggestion]]) {
      if (!value) continue;
      const row = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      extra.append(row);
    }
    extra.classList.toggle("hidden", !extra.childElementCount);

    const author = card.querySelector(".feedback-author");
    author.textContent = entry.author || "Pessoa que testou";
    const rating = card.querySelector(".feedback-rating");
    rating.textContent = `Facilidade ${entry.rating}/5`;
    feedbackList.append(card);
  }
}

function updateSummary() {
  document.querySelector("#total-count").textContent = String(entries.length);
  document.querySelector("#attention-count").textContent = String(entries.filter((entry) => ["High", "Blocker"].includes(entry.severity)).length);
  const average = entries.length
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      .format(entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length)
    : "—";
  document.querySelector("#average-rating").textContent = average;
}

async function loadEntries() {
  feedbackList.innerHTML = '<div class="loading-state">Carregando os relatos compartilhados…</div>';
  const { data, error } = await supabase
    .from("feedback")
    .select("id, user_id, title, tool, category, outcome, severity, details, expected, steps, suggestion, rating, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    feedbackList.replaceChildren();
    showMessage(formMessage, `Não foi possível carregar os relatos compartilhados. ${explainError(error)}`, true);
    return;
  }

  entries = data.map((entry) => ({
    ...entry,
    rating: Number(entry.rating),
    author: entry.user_id === currentUser.id ? currentUser.email : "Grupo de testes",
  }));
  updateSummary();
  renderEntries();
}

async function loadRole() {
  currentRole = "user";
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    showMessage(formMessage, `Não foi possível verificar seu papel. As ações de administrador ficarão indisponíveis. ${explainError(error)}`, true);
    return;
  }
  currentRole = data?.role === "admin" ? "admin" : "user";
  setSignedIn(true);
}

async function deleteEntry(entry) {
  const confirmation = demoMode
    ? "Excluir este relato criado por você na demonstração?"
    : "Tem certeza de que deseja excluir este relato? Esta ação não pode ser desfeita.";
  if (!window.confirm(confirmation)) return;

  if (demoMode) {
    if (!entry.demoOwner) return;
    entries = entries.filter((item) => item.id !== entry.id);
    if (!saveDemoEntries()) return;
    updateSummary();
    renderEntries();
    showMessage(formMessage, "Seu relato foi excluído da demonstração local.");
    return;
  }

  if (!currentUser || (entry.user_id !== currentUser.id && currentRole !== "admin")) {
    showMessage(formMessage, "Você não tem permissão para excluir este relato.", true);
    return;
  }

  const { error } = await supabase.from("feedback").delete().eq("id", entry.id);
  if (error) {
    showMessage(formMessage, `Não foi possível excluir o relato. ${explainError(error)}`, true);
    return;
  }

  showMessage(formMessage, "Relato excluído.");
  await loadEntries();
}

function downloadCsv() {
  const columns = [
    ["title", "Resumo"],
    ["tool", "Ferramenta"],
    ["category", "Tipo"],
    ["outcome", "Resultado"],
    ["severity", "Impacto"],
    ["details", "Relato"],
    ["expected", "Resultado esperado"],
    ["steps", "Etapas para reproduzir"],
    ["suggestion", "Sugestão"],
    ["rating", "Facilidade (1 a 5)"],
    ["author", "Pessoa"],
    ["created_at", "Data"],
  ];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    columns.map(([, label]) => quote(label)).join(","),
    ...entries.map((entry) => columns.map(([column]) => {
      const value = column === "author" ? entry.author
        : column === "category" ? categoryLabels[entry.category] ?? entry.category
          : column === "outcome" ? outcomeLabels[entry.outcome] ?? entry.outcome
            : column === "severity" ? severityLabels[entry.severity] ?? entry.severity
              : column === "created_at" ? formatDate(entry.created_at)
                : entry[column];
      return quote(value);
    }).join(",")),
  ];
  const url = URL.createObjectURL(new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `relatos-de-testes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleAuthChange(session) {
  currentUser = session?.user ?? null;
  demoMode = false;
  currentRole = "user";
  setSignedIn(Boolean(currentUser));
  if (currentUser) {
    await loadRole();
    await loadEntries();
    if (window.location.hash.includes("access_token")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  } else {
    entries = [];
    roleBadge.classList.add("hidden");
  }
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setSignedIn(false);
  showMessage(loginMessage, "Adicione a URL do projeto Supabase e a chave anon em config.js e recarregue a página.", true);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => void handleAuthChange(session), 0);
  });
  supabase.auth.getSession().then(({ data: { session }, error }) => {
    if (error) {
      showMessage(loginMessage, `Não foi possível verificar sua sessão. ${explainError(error)}`, true);
      return;
    }
    void handleAuthChange(session);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = new FormData(loginForm).get("email");
  const button = loginForm.querySelector("button");
  button.disabled = true;
  showMessage(loginMessage, "Enviando seu link seguro de acesso…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  button.disabled = false;
  showMessage(loginMessage, error ? explainError(error) : "Confira seu e-mail: enviamos um link para entrar.", Boolean(error));
});

signOutButton.addEventListener("click", async () => {
  if (demoMode) {
    demoMode = false;
    currentUser = null;
    currentRole = "user";
    entries = [];
    setSignedIn(false);
    showMessage(loginMessage, "Você saiu da demonstração. Seus relatos continuam salvos neste navegador.");
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(formMessage, `Não foi possível sair da conta. ${explainError(error)}`, true);
  else showMessage(loginMessage, "Você saiu da sua conta.");
});

demoButton.addEventListener("click", startDemo);

feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!demoMode && (!supabase || !currentUser)) return;
  submitButton.disabled = true;
  showMessage(formMessage, demoMode ? "Salvando seu relato de demonstração…" : "Compartilhando seu relato…");
  const values = new FormData(feedbackForm);
  const payload = {
    title: values.get("title").trim(),
    area: "Não informado",
    tool: values.get("tool"),
    category: values.get("category"),
    outcome: values.get("outcome"),
    severity: values.get("severity"),
    details: values.get("details").trim(),
    expected: values.get("expected").trim(),
    steps: values.get("steps").trim(),
    suggestion: values.get("suggestion").trim(),
    rating: Number(values.get("rating")),
  };
  if (demoMode) {
    const savedEntry = {
      ...payload,
      id: `demo-${Date.now()}`,
      demoOwner: true,
      author: "Você (demonstração)",
      created_at: new Date().toISOString(),
    };
    entries = [savedEntry, ...entries];
    const saved = saveDemoEntries();
    submitButton.disabled = false;
    if (!saved) return;
    feedbackForm.reset();
    ratingOutput.innerHTML = '3 <span>/ 5</span>';
    updateSummary();
    renderEntries();
    showMessage(formMessage, "Seu relato foi salvo somente neste navegador.");
    return;
  }

  payload.user_id = currentUser.id;
  const { error } = await supabase.from("feedback").insert(payload);
  submitButton.disabled = false;
  if (error) {
    showMessage(formMessage, `Não foi possível compartilhar seu relato. ${explainError(error)}`, true);
    return;
  }

  feedbackForm.reset();
  ratingOutput.innerHTML = '3 <span>/ 5</span>';
  showMessage(formMessage, "Sua experiência foi adicionada ao registro compartilhado.");
  await loadEntries();
});

ratingInput.addEventListener("input", () => {
  ratingOutput.innerHTML = `${ratingInput.value} <span>/ 5</span>`;
});
searchInput.addEventListener("input", renderEntries);
outcomeFilter.addEventListener("change", renderEntries);
toolFilter.addEventListener("change", renderEntries);
document.querySelector("#export-button").addEventListener("click", downloadCsv);
