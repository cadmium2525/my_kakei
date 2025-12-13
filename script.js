// ====================================================================
// I. グローバル設定とデータ構造
// ====================================================================

const APP_DATA_KEY = 'futureflow_app_data_v1';
const MAX_PREDICTION_MONTHS = 360; // 30年

let appData = {
    accounts: [], // [{ id: string, name: string }]
    families: [], // [{ id: string, name: string, age: number, birthMonth: number (1-12) }]
    recurringExpenses: [], // [{ id: string, name: string, amount: number, intervalYears: number (1-5), startYM: string ('YYYY-MM') }]
    futureEvents: [], // [{ id: string, name: string, amount: number, familyId: string, targetAge: number, targetMonth: number (1-12) }]
    monthlyBalances: [], // [{ month: string ('YYYY-MM'), total: number, accounts: { accountId: number } }]
    settings: {
        predictionYears: 30, // 予測期間（年）
    },
};

const RECURRING_INTERVALS = [1, 2, 3, 4, 5];

let currentScreen = 'dashboard';
let currentSettingTab = 'family-account';
let simulationChart = null;

// ====================================================================
// II. データ永続化 (localStorage)
// ====================================================================

/**
 * データをlocalStorageからロードし、Chart.jsの設定と初期描画を行う。
 */
const loadData = () => {
    try {
        const storedData = localStorage.getItem(APP_DATA_KEY);
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            // 既存のデータを上書き（デフォルト値を保持するためにスプレッド演算子を使用）
            appData = { ...appData, ...parsedData };
            // 互換性チェック（旧データ形式から新データ形式への移行ロジックが必要な場合はここに追加）
            console.log("データをロードしました:", appData);
        }
    } catch (error) {
        console.error("データのロード中にエラーが発生しました:", error);
        showMessage("データのロードエラー", "保存されたデータの形式に問題があるため、初期データで開始します。");
    }
};

/**
 * 現在のデータをlocalStorageに保存する。
 */
const saveData = () => {
    try {
        localStorage.setItem(APP_DATA_KEY, JSON.stringify(appData));
    } catch (error) {
        console.error("データの保存中にエラーが発生しました:", error);
        showMessage("データの保存エラー", "データの保存に失敗しました。ブラウザのストレージを確認してください。");
    }
};

/**
 * UUIDを生成する。
 * @returns {string} UUID
 */
const generateId = () => crypto.randomUUID();

// ====================================================================
// III. ユーティリティ関数
// ====================================================================

/**
 * カスタムメッセージボックスを表示する (alert/confirmの代替)。
 * @param {string} title - モーダルのタイトル
 * @param {string} message - 表示するメッセージ
 * @param {boolean} isConfirm - 確認ダイアログかどうか (キャンセルボタンの有無)
 * @returns {Promise<boolean>} OK/キャンセルがクリックされたかどうか
 */
const showMessage = (title, message, isConfirm = false) => {
    return new Promise(resolve => {
        const modal = document.getElementById('message-modal');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        const okButton = document.getElementById('modal-ok');
        const cancelButton = document.getElementById('modal-cancel');

        cancelButton.classList.toggle('hidden', !isConfirm);

        okButton.onclick = () => {
            modal.classList.add('hidden');
            resolve(true);
        };

        if (isConfirm) {
            cancelButton.onclick = () => {
                modal.classList.add('hidden');
                resolve(false);
            };
        }

        modal.classList.remove('hidden');
    });
};

/**
 * 数値を日本円形式にフォーマットする。
 * @param {number} num - 金額
 * @returns {string} フォーマットされた文字列
 */
const formatCurrency = (num) => {
    if (num === null || num === undefined) return 'N/A';
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(num);
};

/**
 * YYYY-MM形式の文字列からDateオブジェクトを作成する。
 * @param {string} ym - YYYY-MM形式の文字列
 * @returns {Date} Dateオブジェクト
 */
const parseYearMonth = (ym) => {
    const [year, month] = ym.split('-').map(Number);
    // 月は0から始まるため -1 する
    return new Date(year, month - 1, 1);
};

/**
 * DateオブジェクトからYYYY-MM形式の文字列を作成する。
 * @param {Date} date - Dateオブジェクト
 * @returns {string} YYYY-MM形式の文字列
 */
const formatDateToYM = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Dateオブジェクトの月を1ヶ月進める。
 * @param {Date} date - 変更するDateオブジェクト
 * @returns {Date} 1ヶ月進んだDateオブジェクト
 */
const addMonth = (date) => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() + 1);
    return newDate;
};

/**
 * 月数の差を計算する (date1 - date2)
 * @param {string} ym1 - YYYY-MM (新しい方)
 * @param {string} ym2 - YYYY-MM (古い方)
 * @returns {number} 月数の差
 */
const diffMonths = (ym1, ym2) => {
    const date1 = parseYearMonth(ym1);
    const date2 = parseYearMonth(ym2);
    return (date1.getFullYear() - date2.getFullYear()) * 12 + (date1.getMonth() - date2.getMonth());
}

/**
 * 特定の月に発生する定期支出の合計額を計算する。
 * @param {string} targetYM - YYYY-MM
 * @param {string} firstBalanceYM - 最初の実績残高の年月 (コア収支計算の開始点)
 * @returns {number} 支出合計額
 */
const getRecurringExpenseForMonth = (targetYM, firstBalanceYM) => {
    const [targetYear, targetMonthNum] = targetYM.split('-').map(Number);
    const targetDate = parseYearMonth(targetYM);
    const firstDate = parseYearMonth(firstBalanceYM);
    
    let expenseTotal = 0;

    appData.recurringExpenses.forEach(exp => {
        const startYM = exp.startYM;
        const intervalYears = exp.intervalYears;

        // 支払い開始年月より前ならスキップ
        if (targetYM.localeCompare(startYM) < 0) return;

        const startDate = parseYearMonth(startYM);
        const [startYear, startMonthNum] = startYM.split('-').map(Number);

        // 発生月が一致するかどうかチェック
        if (targetMonthNum === startMonthNum) {
            // 開始月から何年経過したか
            const yearsPassed = targetYear - startYear;
            
            if (yearsPassed % intervalYears === 0) {
                 expenseTotal += exp.amount;
            }
        }
    });
    return expenseTotal;
}

// ====================================================================
// IV. シミュレーションロジック
// ====================================================================

/**
 * ロジック1: 過去の実績から「定常的な月間変化（コア収支）」を算出する。
 * @returns {number | null} 平均コア収支 (JPY/month) または null (データ不足)
 */
const calculateCoreMonthlyChange = () => {
    // ソートされたコピーを使用して元のデータを変更しないようにする
    const balances = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));

    if (balances.length < 2) {
        return null;
    }

    const firstBalanceYM = balances[0].month;
    const coreChanges = [];

    for (let i = 1; i < balances.length; i++) {
        const currentMonthYM = balances[i].month;
        const prevTotal = balances[i - 1].total;
        const currentTotal = balances[i].total;

        // 1. 実際の残高変化額 (当月残高 - 前月残高)
        let actualChange = currentTotal - prevTotal;

        // 2. 特別支出の除去 (定期支出 + 将来イベント)
        let specialExpenseTotal = getRecurringExpenseForMonth(currentMonthYM, firstBalanceYM);

        // 将来イベントの計算 (過去実績に含まれるイベントは稀だが念のため)
        const [currentYear, currentMonthNum] = currentMonthYM.split('-').map(Number);
        appData.futureEvents.forEach(event => {
            const familyMember = appData.families.find(f => f.id === event.familyId);
            if (!familyMember) return;

            // イベント発生年 (現在の年を基準に計算)
            const now = new Date();
            const nowYear = now.getFullYear();
            const eventYear = (nowYear - familyMember.age) + event.targetAge;

            if (eventYear === currentYear && event.targetMonth === currentMonthNum) {
                specialExpenseTotal += event.amount;
            }
        });

        // 3. 定常的な月間変化 (コア収支) = 実際の変化額 + 特別支出 (支出を戻す)
        const coreChange = actualChange + specialExpenseTotal;
        coreChanges.push(coreChange);
    }

    // 4. 平均コア収支の決定
    if (coreChanges.length === 0) return null;
    const averageCoreChange = coreChanges.reduce((sum, val) => sum + val, 0) / coreChanges.length;
    return Math.round(averageCoreChange);
};

/**
 * ロジック2 & 3: 将来の予測を実行する。
 * @returns {{ labels: string[], data: number[], crashMonth: string | null }} 予測結果
 */
const runSimulation = () => {
    // ソートされたコピーを使用
    const balances = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));
    const predictionYears = appData.settings.predictionYears;
    const maxMonths = Math.min(predictionYears * 12, MAX_PREDICTION_MONTHS);

    if (balances.length === 0) {
        // シミュレーション不可だが、UI描画のために空データを返す
        return { labels: [], data: [], crashMonth: null };
    }

    const averageCoreChange = calculateCoreMonthlyChange();
    const latestBalance = balances[balances.length - 1]; // 修正：pop()を使わない
    const firstBalanceYM = balances[0].month;
    const startDate = addMonth(parseYearMonth(latestBalance.month)); // 予測は最新月の翌月から開始

    let currentBalance = latestBalance.total;
    let currentMonthDate = startDate;
    let crashMonth = null;

    const result = {
        labels: [latestBalance.month], // 実績の最新月をグラフの開始点として残す
        data: [latestBalance.total],
    };

    // 月次シミュレーションを実行
    for (let i = 0; i < maxMonths; i++) {
        const currentMonthYM = formatDateToYM(currentMonthDate);
        let monthlyChange = averageCoreChange || 0; // 平均コア収支をベースに (データ不足なら0)

        // 2. その月に発生する予定の「定期支出」や「将来イベント支出」を計算

        // 定期支出の計算
        monthlyChange -= getRecurringExpenseForMonth(currentMonthYM, firstBalanceYM);

        // 将来イベントの計算 (ロジック2)
        appData.futureEvents.forEach(event => {
            const member = appData.families.find(f => f.id === event.familyId);
            if (!member) return;

            const now = new Date();
            const nowYear = now.getFullYear();
            // イベント発生年 = (現在の年 - 対象家族の現在の年齢) + イベントの目標年齢
            const eventYear = (nowYear - member.age) + event.targetAge;

            const [simYear, simMonthNum] = currentMonthYM.split('-').map(Number);

            if (eventYear === simYear && event.targetMonth === simMonthNum) {
                monthlyChange -= event.amount;
            }
        });


        // 3. 残高を更新
        currentBalance += monthlyChange;
        result.data.push(currentBalance);
        result.labels.push(currentMonthYM);

        // 破産リスクのチェック
        if (currentBalance < 0 && crashMonth === null) {
            crashMonth = currentMonthYM;
        }

        // 次の月へ
        currentMonthDate = addMonth(currentMonthDate);
    }

    return { ...result, crashMonth };
};

// ====================================================================
// V. UIレンダリングとナビゲーション
// ====================================================================

/**
 * 画面を切り替える。
 * @param {string} screenId - 画面ID ('dashboard', 'settings', 'balance-input', 'data-management')
 */
const navigate = (screenId) => {
    currentScreen = screenId;
    renderScreen();
    updateNavBar();
};

/**
 * ナビゲーションバーのアクティブ状態を更新する。
 */
const updateNavBar = () => {
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.dataset.screen === currentScreen) {
            btn.classList.add('nav-item-active', 'text-blue-500');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('nav-item-active', 'text-blue-500');
            btn.classList.add('text-gray-400');
        }
    });
    // Lucideアイコンを再描画
    // Lucideアイコンはscript.jsで初期化されるため、ここでは再実行
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * メイン画面のコンテンツをレンダリングする。
 */
const renderScreen = () => {
    const contentDiv = document.getElementById('app-content');
    contentDiv.innerHTML = '';
    window.scrollTo(0, 0); // 画面切り替え時にトップへスクロール

    switch (currentScreen) {
        case 'dashboard':
            renderDashboard(contentDiv);
            break;
        case 'settings':
            renderSettings(contentDiv);
            break;
        case 'balance-input':
            renderBalanceInput(contentDiv);
            break;
        case 'data-management':
            renderDataManagement(contentDiv);
            break;
    }
};

// --- ダッシュボード画面のレンダリング ---
const renderDashboard = (container) => {
    // ************************************************************
    // ★修正箇所★: .pop()によるデータ破壊を防ぐため、最新データを安全に取得
    // ************************************************************
    const balancesSorted = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));
    const latestBalance = balancesSorted.length > 0 ? balancesSorted[balancesSorted.length - 1] : null;
    // ************************************************************

    const coreChange = calculateCoreMonthlyChange();
    const simulationResult = runSimulation();
    const hasEnoughData = appData.monthlyBalances.length >= 2;

    let summaryHtml = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="card p-3">
                    <p class="text-sm text-gray-400">最新の総残高 (${latestBalance ? latestBalance.month : 'N/A'})</p>
                    <p class="text-2xl font-bold ${latestBalance && latestBalance.total < 0 ? 'text-red-400' : 'text-green-400'}">
                        ${latestBalance ? formatCurrency(latestBalance.total) : formatCurrency(0)}
                    </p>
                </div>
                <div class="card p-3">
                    <p class="text-sm text-gray-400">平均コア収支 (月)</p>
                    <p class="text-2xl font-bold ${coreChange && coreChange < 0 ? 'text-red-400' : 'text-green-400'}">
                        ${coreChange !== null ? formatCurrency(coreChange) : 'データ不足 (2ヶ月実績が必要)'}
                    </p>
                </div>
            </div>
    `;

    if (latestBalance) {
        const totalMonths = simulationResult.labels.length;
        // latestBalanceがnullでないことを保証してからアクセスする
        const predictionStart = latestBalance.month;
        const predictionEnd = simulationResult.labels[totalMonths - 1];
        let riskText;

        if (!hasEnoughData) {
            riskText = `
                <p class="text-orange-400 font-semibold flex items-center">
                    <i data-lucide="info" class="w-5 h-5 mr-2"></i>
                    予測の精度向上には2ヶ月以上の実績が必要です。
                </p>
            `;
        } else if (simulationResult.crashMonth) {
            const monthsToCrash = diffMonths(simulationResult.crashMonth, predictionStart);
            const years = Math.floor(monthsToCrash / 12);
            const months = monthsToCrash % 12;

            riskText = `
                <p class="text-alert-color font-semibold flex items-center">
                    <i data-lucide="alert-triangle" class="w-5 h-5 mr-2"></i>
                    <span class="animate-pulse">⚠️ 破産リスクあり: ${simulationResult.crashMonth}</span>
                </p>
                <p class="text-sm text-gray-300 ml-7">残り ${years}年 ${months}ヶ月で総残高がマイナスになります。</p>
            `;
        } else {
            riskText = `
                <p class="text-green-400 font-semibold flex items-center">
                    <i data-lucide="check-circle" class="w-5 h-5 mr-2"></i>
                    予測期間 (${appData.settings.predictionYears}年) 中に破産リスクはありません。
                </p>
            `;
        }

        summaryHtml += `
            <div class="card p-3 space-y-2">
                <h3 class="text-lg font-bold">破産リスク分析</h3>
                ${riskText}
                <p class="text-xs text-gray-500 mt-2">予測期間: ${predictionStart} の翌月 〜 ${predictionEnd}</p>
            </div>
        `;
    } else {
        summaryHtml += `<div class="card p-3 text-center text-gray-400">残高実績データが不足しています。残高を入力してください。</div>`;
    }

    summaryHtml += `</div><h2 class="text-2xl font-bold mt-6 mb-3">総資産の長期予測 (${appData.settings.predictionYears}年)</h2>`;
    container.innerHTML += summaryHtml;

    // グラフコンテナの追加
    container.innerHTML += `
        <div class="card">
            <div id="chart-container">
                <canvas id="balanceChart"></canvas>
            </div>
        </div>
        <h2 class="text-xl font-bold mt-6 mb-3">各口座の最新残高</h2>
        <div id="account-balances" class="card">
            ${renderAccountBalances(latestBalance)}
        </div>
        <div class="h-24"></div>
    `;

    // Chart.jsの描画
    if (latestBalance) {
        drawChart(simulationResult, latestBalance.total, latestBalance.month, simulationResult.crashMonth);
    } else {
         document.getElementById('chart-container').innerHTML = '<p class="text-center text-gray-400 py-10">残高実績を登録するとグラフが表示されます。</p>';
    }

    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * 最新の口座残高をレンダリングする。
 * @param {Object} latestBalance - 最新の月次残高データ
 * @returns {string} HTML文字列
 */
const renderAccountBalances = (latestBalance) => {
    if (!latestBalance) {
        return '<p class="text-gray-400">残高実績がありません。</p>';
    }

    if (appData.accounts.length === 0) {
         return '<p class="text-gray-400">口座情報が登録されていません。</p>';
    }

    let html = '<ul class="space-y-2">';
    appData.accounts.forEach(account => {
        const balance = latestBalance.accounts[account.id] || 0;
        html += `
            <li class="flex justify-between items-center py-1 border-b border-gray-700 last:border-b-0">
                <span class="text-gray-300">${account.name}</span>
                <span class="font-semibold ${balance < 0 ? 'text-red-400' : 'text-green-400'}">${formatCurrency(balance)}</span>
            </li>
        `;
    });
    html += '</ul>';
    return html;
};

/**
 * Chart.jsを使用して予測グラフを描画する。
 * @param {Object} data - シミュレーション結果データ
 * @param {number} startBalance - 最新の実績残高
 * @param {string} startMonth - 最新の実績月
 * @param {string | null} crashMonth - 破産月
 */
const drawChart = (data, startBalance, startMonth, crashMonth) => {
    if (simulationChart) {
        simulationChart.destroy();
    }
    const ctx = document.getElementById('balanceChart').getContext('2d');

    // グラフ表示用のデータセットを準備
    const chartLabels = data.labels;
    const chartData = data.data;

    let crashIndex = -1;
    if (crashMonth) {
        crashIndex = chartLabels.findIndex(l => l === crashMonth);
    }

    const datasets = [{
        label: '総資産予測 (JPY)',
        data: chartData,
        borderColor: 'var(--accent-color)',
        borderWidth: 2,
        pointRadius: 0, // ポイントを非表示
        tension: 0.1,
        fill: false
    }];

    if (crashIndex !== -1) {
        // 破産ポイントをハイライトするデータセットを追加
        datasets.push({
            label: '破産リスク',
            data: chartData.map((d, i) => (i >= crashIndex ? d : NaN)),
            borderColor: 'var(--alert-color)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: 'var(--alert-color)',
            pointBorderColor: 'var(--alert-color)',
            tension: 0.1,
            fill: false,
            showLine: true
        });
    }

    simulationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    },
                    bodyFont: { family: 'Inter', size: 14 },
                    titleFont: { family: 'Inter', size: 14 }
                }
            },
            scales: {
                x: {
                    grid: { color: '#374151' },
                    ticks: {
                        color: 'var(--text-color)',
                        maxTicksLimit: 12, // 年次表示
                        callback: function(value, index, values) {
                            // 3年に1回だけ表示
                            const ym = chartLabels[index] ? chartLabels[index].split('-') : [];
                            const year = ym.length > 0 ? ym[0] : '';
                            
                            if (index % 36 === 0) return year; // 3年に1回
                            return '';
                        }
                    }
                },
                y: {
                    beginAtZero: false,
                    grid: { color: '#374151' },
                    ticks: {
                        color: 'var(--text-color)',
                        callback: function(value) {
                            // 億, 万表記
                            if (value >= 100000000) return (value / 100000000).toFixed(1) + '億';
                            if (value >= 10000) return (value / 10000).toFixed(0) + '万';
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
};

// --- 設定・登録画面のレンダリング ---
const renderSettings = (container) => {
    container.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">設定・データ登録</h2>

        <div class="flex border-b border-gray-700 mb-6 overflow-x-auto hide-scrollbar">
            <button data-tab="family-account" onclick="setSettingsTab('family-account')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">家族・口座情報</button>
            <button data-tab="recurring" onclick="setSettingsTab('recurring')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">定期支出</button>
            <button data-tab="future-event" onclick="setSettingsTab('future-event')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">将来イベント</button>
            <button data-tab="sim-config" onclick="setSettingsTab('sim-config')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">シミュレーション設定</button>
        </div>

        <div id="settings-tab-content"></div>
        `;
    setSettingsTab(currentSettingTab);
};

/**
 * 設定画面のタブを切り替える。
 * @param {string} tab - タブID
 */
const setSettingsTab = (tab) => {
    currentSettingTab = tab;
    const contentDiv = document.getElementById('settings-tab-content');

    // ボタンのアクティブ状態を更新
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.classList.add('border-blue-500', 'text-blue-500');
            btn.classList.remove('text-gray-400', 'hover:text-blue-400');
        } else {
            btn.classList.remove('border-blue-500', 'text-blue-500');
            btn.classList.add('text-gray-400', 'hover:text-blue-400');
        }
    });

    switch (tab) {
        case 'family-account':
            contentDiv.innerHTML = renderFamilyAccountTab();
            break;
        case 'recurring':
            contentDiv.innerHTML = renderRecurringTab();
            break;
        case 'future-event':
            contentDiv.innerHTML = renderFutureEventTab();
            break;
        case 'sim-config':
            contentDiv.innerHTML = renderSimConfigTab();
            break;
    }
    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
    // イベントリスナーの再登録
    document.getElementById('add-account-form')?.addEventListener('submit', handleAddAccount);
    document.getElementById('add-family-form')?.addEventListener('submit', handleAddFamily);
    document.getElementById('add-recurring-form')?.addEventListener('submit', handleAddRecurring);
    document.getElementById('add-future-event-form')?.addEventListener('submit', handleAddFutureEvent);
    document.getElementById('sim-config-form')?.addEventListener('submit', handleSimConfigUpdate);
};

// --- 設定タブのレンダリング関数 ---

const renderFamilyAccountTab = () => {
    let html = `
        <div class="card mb-6">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">口座情報登録</h3>
            <form id="add-account-form" class="space-y-3">
                <label for="account-name" class="block text-sm font-medium mb-1 text-gray-300">口座名</label>
                <input type="text" id="account-name" placeholder="例: メイン銀行" required
                    class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">口座を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.accounts.length}件の口座</p>
                ${appData.accounts.map(acc => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span>${acc.name}</span>
                        <button onclick="deleteItem('accounts', '${acc.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </div>

        <div class="card">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">家族情報登録</h3>
            <form id="add-family-form" class="space-y-3">
                <label for="family-name" class="block text-sm font-medium mb-1 text-gray-300">氏名</label>
                <input type="text" id="family-name" placeholder="氏名" required
                    class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                <div class="grid grid-cols-2 gap-3">
                     <div>
                        <label for="family-age" class="block text-sm font-medium mb-1 text-gray-300">現在の年齢</label>
                        <input type="number" id="family-age" placeholder="年齢" min="0" required
                            class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label for="family-birth-month" class="block text-sm font-medium mb-1 text-gray-300">誕生日月</label>
                        <select id="family-birth-month" required
                            class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                            <option value="">誕生日月を選択</option>
                            ${Array.from({length: 12}, (_, i) => i + 1).map(m => `<option value="${m}">${m}月</option>`).join('')}
                        </select>
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">家族を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.families.length}件の家族</p>
                ${appData.families.map(fam => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span>${fam.name} (${fam.age}歳, ${fam.birthMonth}月生)</span>
                        <button onclick="deleteItem('families', '${fam.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

const renderRecurringTab = () => {
     // 今日のYYYY-MMをデフォルト値として取得
    const todayYM = new Date().toISOString().slice(0, 7);

    let html = `
        <div class="card mb-6">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">定期支出登録</h3>
            <form id="add-recurring-form" class="space-y-3">
                <label for="recurring-name" class="block text-sm font-medium mb-1 text-gray-300">支出名前</label>
                <input type="text" id="recurring-name" placeholder="例: 年払い保険" required
                    class="w-full p-2 rounded-lg">
                
                <label for="recurring-amount" class="block text-sm font-medium mb-1 text-gray-300">金額 (JPY)</label>
                <input type="number" id="recurring-amount" placeholder="金額" min="1" required
                    class="w-full p-2 rounded-lg">
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="recurring-interval" class="block text-sm font-medium mb-1 text-gray-300">支払い間隔</label>
                        <select id="recurring-interval" required
                            class="w-full p-2 rounded-lg">
                            <option value="">支払い間隔を選択</option>
                            ${RECURRING_INTERVALS.map(y => `<option value="${y}">${y}年</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label for="recurring-start-ym" class="block text-sm font-medium mb-1 text-gray-300">支払い開始年月</label>
                        <input type="month" id="recurring-start-ym" value="${todayYM}" required
                            class="w-full p-2 rounded-lg">
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">定期支出を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.recurringExpenses.length}件の定期支出</p>
                ${appData.recurringExpenses.map(exp => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span>${exp.name}: ${formatCurrency(exp.amount)} (${exp.intervalYears}年ごと・開始${exp.startYM})</span>
                        <button onclick="deleteItem('recurringExpenses', '${exp.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

const renderFutureEventTab = () => {
    if (appData.families.length === 0) {
        return `
            <div class="card p-4 text-center">
                <p class="text-gray-400">将来イベントを登録するには、まず「家族・口座情報」タブで家族を登録してください。</p>
                <button onclick="setSettingsTab('family-account')" class="mt-3 py-1 px-3 bg-blue-600 rounded-lg text-sm">家族を登録</button>
            </div>
            <div class="h-24"></div>
        `;
    }

    let html = `
        <div class="card mb-6">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">将来イベント登録</h3>
            <form id="add-future-event-form" class="space-y-3">
                <label for="event-name" class="block text-sm font-medium mb-1 text-gray-300">イベント名</label>
                <input type="text" id="event-name" placeholder="例: 住宅購入頭金, 大学入学" required
                    class="w-full p-2 rounded-lg">
                
                <label for="event-amount" class="block text-sm font-medium mb-1 text-gray-300">金額 (JPY)</label>
                <input type="number" id="event-amount" placeholder="金額" min="1" required
                    class="w-full p-2 rounded-lg">
                
                <label for="event-family-id" class="block text-sm font-medium mb-1 text-gray-300">対象家族</label>
                <select id="event-family-id" required
                    class="w-full p-2 rounded-lg">
                    <option value="">対象家族を選択</option>
                    ${appData.families.map(fam => `<option value="${fam.id}">${fam.name} (現${fam.age}歳)</option>`).join('')}
                </select>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="event-target-age" class="block text-sm font-medium mb-1 text-gray-300">目標年齢</label>
                        <input type="number" id="event-target-age" placeholder="目標年齢" min="1" required
                            class="w-full p-2 rounded-lg">
                    </div>
                    <div>
                        <label for="event-target-month" class="block text-sm font-medium mb-1 text-gray-300">発生月</label>
                        <select id="event-target-month" required
                            class="w-full p-2 rounded-lg">
                            <option value="">発生月を選択</option>
                            ${Array.from({length: 12}, (_, i) => i + 1).map(m => `<option value="${m}">${m}月</option>`).join('')}
                        </select>
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">イベントを追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.futureEvents.length}件の将来イベント</p>
                ${appData.futureEvents.map(event => {
                    const famName = appData.families.find(f => f.id === event.familyId)?.name || '不明';
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    const family = appData.families.find(f => f.id === event.familyId);
                    const eventYear = family ? (currentYear - family.age) + event.targetAge : 'N/A';
                    return `
                        <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg text-sm">
                            <span>
                                ${event.name} (${formatCurrency(event.amount)})<br>
                                <span class="text-gray-400">${famName}が${event.targetAge}歳になる ${eventYear}年${event.targetMonth}月</span>
                            </span>
                            <button onclick="deleteItem('futureEvents', '${event.id}')" class="text-red-400 hover:text-red-500 p-1">
                                <i data-lucide="x" class="w-5 h-5"></i>
                            </button>
                        </li>
                    `;
                }).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

const renderSimConfigTab = () => {
     let html = `
        <div class="card">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">シミュレーション設定</h3>
            <form id="sim-config-form" class="space-y-4">
                <label for="prediction-years" class="block text-sm font-medium text-gray-300">予測期間 (年)</label>
                <input type="number" id="prediction-years" name="predictionYears" placeholder="最大30年" min="1" max="30" value="${appData.settings.predictionYears}" required
                    class="w-full p-2 rounded-lg">
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">設定を更新</button>
            </form>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

// --- 残高入力画面のレンダリング ---
const renderBalanceInput = (container) => {
    const today = new Date();
    const defaultMonth = formatDateToYM(today);

    let accountInputs = appData.accounts.map(acc => {
        // 最新の残高データを取得し、該当口座の値を初期値として使用
        const latestData = [...appData.monthlyBalances].sort((a, b) => b.month.localeCompare(a.month)).find(item => item.month === defaultMonth);
        const initialValue = latestData ? (latestData.accounts[acc.id] || 0) : 0;

        return `
            <div class="mb-3">
                <label for="balance-${acc.id}" class="block text-sm font-medium mb-1">${acc.name} の残高 (JPY)</label>
                <input type="number" id="balance-${acc.id}" data-id="${acc.id}" placeholder="金額を入力" value="${initialValue}" required
                    class="w-full p-2 rounded-lg balance-input">
            </div>
        `;
    }).join('');

    let historyList = appData.monthlyBalances.sort((a, b) => b.month.localeCompare(a.month)).map(item => `
        <li class="flex justify-between items-center bg-gray-700 p-3 rounded-lg text-sm">
            <span class="font-semibold">${item.month}</span>
            <span class="${item.total < 0 ? 'text-red-400' : 'text-green-400'} font-bold">${formatCurrency(item.total)}</span>
            <button onclick="deleteItem('monthlyBalances', '${item.month}', true)" class="text-red-400 hover:text-red-500 p-1">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        </li>
    `).join('');

    container.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">月次総残高入力</h2>
        <p class="mb-4 text-gray-400">最新の実績残高を記録することで、予測の精度が向上します。</p>

        <div class="card mb-6">
            ${appData.accounts.length === 0 ? `
                <p class="text-center text-red-400 mb-3">⚠️ まず「設定・登録」で口座を登録してください。</p>
                <button onclick="navigate('settings')" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">設定画面へ</button>
            ` : `
                <form id="balance-input-form" class="space-y-3">
                    <label for="balance-month" class="block text-sm font-medium mb-1">入力月</label>
                    <input type="month" id="balance-month" value="${defaultMonth}" required
                        class="w-full p-2 rounded-lg">

                    <div id="account-inputs" class="space-y-3 mt-4">
                        ${accountInputs}
                    </div>

                    <div class="text-lg font-bold pt-3 border-t border-gray-700 flex justify-between">
                        <span>合計残高 (自動計算):</span>
                        <span id="current-total-balance" class="text-green-400">${formatCurrency(0)}</span>
                    </div>

                    <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">残高を登録・更新</button>
                </form>
            `}
        </div>

        <h3 class="text-xl font-bold mb-3">過去の入力履歴 (${appData.monthlyBalances.length}件)</h3>
        <ul class="card space-y-2 hide-scrollbar h-64 overflow-y-auto">
            ${historyList.length > 0 ? historyList : '<li class="text-gray-400 text-center py-4">履歴がありません。</li>'}
        </ul>
        <div class="h-24"></div>
    `;
     // イベントリスナーの登録
    if (appData.accounts.length > 0) {
        document.getElementById('balance-input-form')?.addEventListener('submit', handleBalanceInput);
        document.querySelectorAll('.balance-input').forEach(input => {
            input.addEventListener('input', updateBalanceTotal);
        });
    }
     // 初期合計残高の更新
    if (appData.accounts.length > 0) updateBalanceTotal();
    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * 口座残高入力時の合計残高をリアルタイムで更新する。
 */
const updateBalanceTotal = () => {
    let total = 0;
    document.querySelectorAll('.balance-input').forEach(input => {
        total += Number(input.value) || 0;
    });
    const totalSpan = document.getElementById('current-total-balance');
    if (totalSpan) {
        totalSpan.textContent = formatCurrency(total);
        totalSpan.classList.toggle('text-red-400', total < 0);
        totalSpan.classList.toggle('text-green-400', total >= 0);
    }
};

// --- データ管理画面のレンダリング ---
const renderDataManagement = (container) => {
    container.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">データ管理</h2>
        <p class="mb-6 text-gray-400">データのバックアップ、復元、全削除を行います。</p>

        <div class="card mb-6 space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2">データのエクスポート (JSON)</h3>
            <p class="text-sm text-gray-400">現在のデータをJSONファイルとしてダウンロードします。</p>
            <button onclick="handleExportData()" class="w-full py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="cloud-download" class="w-5 h-5 mr-2"></i> 全データをエクスポート
            </button>
        </div>

        <div class="card mb-6 space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2">データのインポート (JSON)</h3>
            <p class="text-sm text-red-300">※インポートされたデータは現在のデータを上書きします。</p>
            <input type="file" id="import-file-input" accept="application/json" class="w-full text-sm text-gray-400
                file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
            <button onclick="handleImportData()" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="cloud-upload" class="w-5 h-5 mr-2"></i> インポートを実行
            </button>
        </div>

        <div class="card space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2 text-red-400">全データの削除</h3>
            <p class="text-sm text-red-300">この操作は元に戻せません。全ての家計データがブラウザから削除されます。</p>
            <button onclick="handleClearData()" class="w-full py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="alert-triangle" class="w-5 h-5 mr-2"></i> 全データを削除
            </button>
        </div>

        <div class="h-24"></div>
    `;
    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

// ====================================================================
// VI. イベントハンドラ
// ====================================================================

/**
 * 新しい口座を登録する。
 */
const handleAddAccount = (e) => {
    e.preventDefault();
    const name = document.getElementById('account-name').value.trim();
    if (name) {
        appData.accounts.push({ id: generateId(), name });
        saveData();
        setSettingsTab('family-account');
        showMessage("登録完了", `${name} 口座が追加されました。`);
    }
};

/**
 * 家族情報を登録する。
 */
const handleAddFamily = (e) => {
    e.preventDefault();
    const name = document.getElementById('family-name').value.trim();
    const age = parseInt(document.getElementById('family-age').value);
    const birthMonth = parseInt(document.getElementById('family-birth-month').value);

    if (name && !isNaN(age) && !isNaN(birthMonth)) {
        appData.families.push({ id: generateId(), name, age, birthMonth });
        saveData();
        setSettingsTab('family-account');
        showMessage("登録完了", `${name} 様の家族情報が追加されました。`);
    }
};

/**
 * 定期支出を登録する。
 */
const handleAddRecurring = (e) => {
    e.preventDefault();
    const name = document.getElementById('recurring-name').value.trim();
    const amount = parseInt(document.getElementById('recurring-amount').value);
    const intervalYears = parseInt(document.getElementById('recurring-interval').value);
    const startYM = document.getElementById('recurring-start-ym').value;

    if (name && !isNaN(amount) && !isNaN(intervalYears) && startYM) {
        appData.recurringExpenses.push({ id: generateId(), name, amount, intervalYears, startYM });
        saveData();
        setSettingsTab('recurring');
        showMessage("登録完了", `${name} の定期支出が追加されました。`);
    } else {
        showMessage("入力エラー", "全ての項目を正しく入力してください。");
    }
};

/**
 * 将来イベントを登録する。
 */
const handleAddFutureEvent = (e) => {
    e.preventDefault();
    const name = document.getElementById('event-name').value.trim();
    const amount = parseInt(document.getElementById('event-amount').value);
    const familyId = document.getElementById('event-family-id').value;
    const targetAge = parseInt(document.getElementById('event-target-age').value);
    const targetMonth = parseInt(document.getElementById('event-target-month').value);

    if (name && !isNaN(amount) && familyId && !isNaN(targetAge) && !isNaN(targetMonth)) {
        appData.futureEvents.push({ id: generateId(), name, amount, familyId, targetAge, targetMonth });
        saveData();
        setSettingsTab('future-event');
        showMessage("登録完了", `${name} イベントが追加されました。`);
    }
};

/**
 * シミュレーション設定を更新する。
 */
const handleSimConfigUpdate = (e) => {
    e.preventDefault();
    const years = parseInt(document.getElementById('prediction-years').value);
    if (!isNaN(years) && years > 0 && years <= MAX_PREDICTION_MONTHS / 12) {
        appData.settings.predictionYears = years;
        saveData();
        setSettingsTab('sim-config');
        showMessage("設定更新", `予測期間が${years}年に更新されました。`);
    } else {
         showMessage("入力エラー", `予測期間は1〜${MAX_PREDICTION_MONTHS / 12}年の間で入力してください。`);
    }
};

/**
 * 月次残高を登録・更新する。
 */
const handleBalanceInput = (e) => {
    e.preventDefault();
    const month = document.getElementById('balance-month').value;
    if (!month) {
        showMessage("エラー", "入力月を選択してください。");
        return;
    }

    let total = 0;
    const accountBalances = {};
    let allInputsValid = true;

    document.querySelectorAll('.balance-input').forEach(input => {
        const amount = Number(input.value);
        if (isNaN(amount)) {
            allInputsValid = false;
            return;
        }
        const accountId = input.dataset.id;
        accountBalances[accountId] = amount;
        total += amount;
    });

    if (!allInputsValid) {
        showMessage("エラー", "残高は数値で入力してください。");
        return;
    }

    // 既存の月があれば更新、なければ追加
    const existingIndex = appData.monthlyBalances.findIndex(item => item.month === month);
    const newBalanceItem = { month, total, accounts: accountBalances };

    if (existingIndex !== -1) {
        appData.monthlyBalances[existingIndex] = newBalanceItem;
        showMessage("更新完了", `${month} の残高実績が更新されました。`);
    } else {
        appData.monthlyBalances.push(newBalanceItem);
        showMessage("登録完了", `${month} の残高実績が新規登録されました。`);
    }

    // 月次残高は常にソートして保存する
    appData.monthlyBalances.sort((a, b) => a.month.localeCompare(b.month));
    saveData();
    renderBalanceInput(document.getElementById('app-content'));
};

/**
 * 指定されたコレクションからアイテムを削除する。
 * @param {string} collection - コレクション名
 * @param {string} id - アイテムID (月次残高の場合はYYYY-MM)
 * @param {boolean} isMonth - 月次残高かどうか
 */
const deleteItem = async (collection, id, isMonth = false) => {
    const confirmed = await showMessage("削除の確認", "本当にこのデータを削除してもよろしいですか？", true);
    if (!confirmed) return;

    if (isMonth) {
        appData[collection] = appData[collection].filter(item => item.month !== id);
    } else {
        appData[collection] = appData[collection].filter(item => item.id !== id);
    }
    saveData();
    // 削除後の画面を再描画
    if (collection === 'monthlyBalances') {
        navigate('balance-input');
    } else {
        setSettingsTab(currentSettingTab);
    }
    showMessage("削除完了", "データが削除されました。");
};

/**
 * データをJSONファイルとしてエクスポートする。
 */
const handleExportData = () => {
    const dataStr = JSON.stringify(appData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `FutureFlow_export_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    showMessage("エクスポート完了", "データがJSONファイルとしてダウンロードされました。");
};

/**
 * JSONファイルを読み込み、データをインポートする。
 */
const handleImportData = () => {
    const input = document.getElementById('import-file-input');
    const file = input.files[0];

    if (!file) {
        showMessage("エラー", "JSONファイルを選択してください。");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            // 必須キーの簡易チェック
            if (importedData.accounts && importedData.families) {
                 const confirmed = await showMessage("インポートの確認", "現在のデータは上書きされます。よろしいですか？", true);
                 if (!confirmed) return;

                appData = { ...appData, ...importedData };
                saveData();
                navigate('dashboard');
                showMessage("インポート完了", "データが正常にインポートされました。");
            } else {
                throw new Error("JSONファイルの構造が不正です。");
            }
        } catch (e) {
            console.error("インポートエラー:", e);
            showMessage("インポート失敗", "ファイルの読み込みまたは解析に失敗しました。ファイル形式を確認してください。");
        }
    };
    reader.readAsText(file);
};

/**
 * 全データを削除する。
 */
const handleClearData = async () => {
    const confirmed = await showMessage("全データ削除の確認", "この操作は元に戻せません。全ての家計データを削除しますか？", true);
    if (!confirmed) return;

    localStorage.removeItem(APP_DATA_KEY);
    // 初期データに戻す
    appData = {
        accounts: [], families: [], recurringExpenses: [], futureEvents: [], monthlyBalances: [], settings: { predictionYears: 30 },
    };
    navigate('dashboard');
    showMessage("削除完了", "全てのデータが削除されました。");
};

// ====================================================================
// VII. アプリケーションの初期化
// ====================================================================

/**
 * アプリケーションの初期化処理
 */
const initializeApp = () => {
    loadData();
    navigate('dashboard');
};

// HTML読み込み完了後に初期化関数を実行
window.onload = initializeApp;

// グローバルスコープに必要な関数を公開
window.navigate = navigate;
window.setSettingsTab = setSettingsTab;
window.deleteItem = deleteItem;
window.handleExportData = handleExportData;
window.handleImportData = handleImportData;
window.handleClearData = handleClearData;