(function attachDailyReport(globalScope) {
  const STAGE_ORDER = [
    'Виконано у Worksection',
    'Виконано у GitHub',
    'В роботі',
    'Code Review',
    'Процесні та мета-задачі',
    'Регулярні службові записи'
  ];

  function firstNumber(text, fallback = 0) {
    const match = String(text || '').match(/\d+/);
    return match ? Number(match[0]) : fallback;
  }

  function matchNumber(markdown, pattern, fallback = 0) {
    const match = markdown.match(pattern);
    return match ? Number(match[1]) : fallback;
  }

  function stripMarkdown(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[*`>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getSection(markdown, heading) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^## ${escaped}\\s*([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'm');
    const match = markdown.match(regex);
    return match ? match[1].trim() : '';
  }

  function getSubsection(markdown, heading) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^### ${escaped}\\s*([\\s\\S]*?)(?=\\n### |\\n## |(?![\\s\\S]))`, 'm');
    const match = markdown.match(regex);
    return match ? match[1].trim() : '';
  }

  function parseProjectStructure(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const levels = [];
    const services = [];
    const flows = [];
    const sourceNotes = [];
    let currentLevel = null;
    let currentSection = '';

    function addService(level, key, label, description) {
      if (!key || services.some((service) => service.key === key)) return;
      const service = {
        key,
        label: label || key,
        description: stripMarkdown(description || ''),
        levelId: level.id,
        domain: level.title
      };
      level.services.push(service);
      services.push(service);
    }

    function serviceTokens(text) {
      const codeTokens = String(text || '').match(/`([^`]+)`/g) || [];
      return codeTokens.map((token) => token.slice(1, -1)).filter((token) => /[a-zA-Z]/.test(token));
    }

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) {
        currentSection = stripMarkdown(heading[1]);
        currentLevel = null;
        if (/ключові потоки/i.test(currentSection)) return;
        if (/перевірені джерела|обмеження/i.test(currentSection)) return;
        if (/як читати дерево/i.test(currentSection)) return;
        currentLevel = {
          id: `level-${levels.length + 1}`,
          title: currentSection,
          services: []
        };
        levels.push(currentLevel);
        return;
      }

      if (/^\d+\.\s+/.test(line) && /ключові потоки/i.test(currentSection)) {
        const flowText = stripMarkdown(line.replace(/^\d+\.\s+/, ''));
        const label = flowText.split(':')[0] || `Потік ${flows.length + 1}`;
        const rawSteps = flowText.includes(':') ? flowText.slice(flowText.indexOf(':') + 1) : flowText;
        const steps = rawSteps.split(/\s*→\s*/).map((step) => step.trim()).filter(Boolean);
        flows.push({ key: `flow-${flows.length + 1}`, label, description: flowText, steps });
        return;
      }

      if (/^[-*]\s+/.test(line) && /перевірені джерела|обмеження/i.test(currentSection)) {
        sourceNotes.push(stripMarkdown(line.replace(/^[-*]\s+/, '')));
        return;
      }

      if (line && /обмеження/i.test(currentSection) && !/^[-*]\s+/.test(line)) {
        sourceNotes.push(stripMarkdown(line));
        return;
      }

      if (/^[-*]\s+/.test(line) && currentLevel) {
        const rawItem = line.replace(/^[-*]\s+/, '');
        const tokens = serviceTokens(rawItem);
        const item = stripMarkdown(rawItem);
        if (tokens.length) {
          tokens.forEach((token) => addService(currentLevel, token, token, item));
        } else {
          const parts = item.split(/\s+[—-]\s+/, 2);
          addService(currentLevel, parts[0].split(':')[0].trim(), parts[0].trim(), parts[1] || item);
        }
      }

      if (/^[-*]\s+/.test(line) && /як читати дерево/i.test(currentSection)) {
        const rawItem = line.replace(/^[-*]\s+/, '');
        const item = stripMarkdown(rawItem);
        const parts = item.split(/:\s*/, 2);
        const level = { id: `level-${levels.length + 1}`, title: parts[0], services: [] };
        levels.push(level);
        const tokens = serviceTokens(rawItem);
        if (tokens.length) {
          tokens.forEach((token) => addService(level, token, token, parts[1] || item));
        } else {
          (parts[1] || item).split(/,\s*|\s+та\s+/).map((value) => value.trim()).filter(Boolean).forEach((label) => {
            addService(level, label.toLowerCase().replace(/\s+/g, '-'), label, item);
          });
        }
      }
    });

    return { levels, services, flows, sourceNote: sourceNotes.join(' ') };
  }

  function mergeStructureWithReport(structure, report) {
    const allItems = [
      ...(report.githubDone || []),
      ...(report.active?.items || []),
      ...(report.reviewItems || []),
      ...(report.risks || []),
      ...Object.values(report.people || {}).flatMap((person) => person.done || [])
    ];
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '');
    const serviceAliases = {
      'frontend-nextjs': ['frontend', 'кабінет'],
      'main-orchestrator': ['orchestrator', 'оркестратор'],
      'document-flow': ['document', 'документ', 'agreements'],
      'income_accounting_book_report': ['income', 'книга доходів', 'облік'],
      way4pay: ['way4pay', 'оплата', 'платіж']
    };
    const result = structure.services.map((service) => {
      const aliases = [service.key, service.label, ...(serviceAliases[service.key] || [])].map(normalize);
      const matches = allItems.filter((item) => aliases.some((alias) => alias && normalize(item).includes(alias)));
      const active = matches.filter((item) => (report.active?.items || []).includes(item)).length;
      const done = matches.filter((item) => (report.githubDone || []).includes(item) || Object.values(report.people || {}).some((person) => (person.done || []).includes(item))).length;
      const hasRisk = matches.some((item) => (report.risks || []).includes(item));
      const hasReview = matches.some((item) => (report.reviewItems || []).includes(item));
      const status = hasRisk ? 'ризик' : hasReview ? 'review' : active ? 'в роботі' : done ? 'є виконані' : 'немає активності';
      return { ...service, tasks: matches, done, active, status, pr: hasReview ? 1 : 0 };
    });
    const assigned = new Set(result.flatMap((service) => service.tasks));
    const unassigned = allItems.filter((item) => !assigned.has(item));
    return { ...structure, services: result, unassigned };
  }

  function listItems(block) {
    return String(block || '')
      .split('\n')
      .filter((line) => /^[*-]\s+/.test(line.trim()))
      .map((line) => stripMarkdown(line.trim().replace(/^[*-]\s+/, '')))
      .filter(Boolean);
  }

  function numberedItems(block) {
    return String(block || '')
      .split('\n')
      .filter((line) => /^\d+\.\s+/.test(line.trim()))
      .map((line) => stripMarkdown(line.replace(/^\d+\.\s+/, '')))
      .filter(Boolean);
  }

  function parseStageRows(markdown) {
    const rows = [];
    const rowPattern = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
    let match;
    while ((match = rowPattern.exec(markdown)) !== null) {
      const stage = stripMarkdown(match[1]);
      if (!STAGE_ORDER.includes(stage)) continue;
      rows.push({
        label: stage,
        valueText: stripMarkdown(match[2]),
        value: firstNumber(match[2]),
        note: stripMarkdown(match[3])
      });
    }
    return rows.sort((a, b) => STAGE_ORDER.indexOf(a.label) - STAGE_ORDER.indexOf(b.label));
  }

  function parseModuleBlocks(markdown) {
    const section = getSubsection(markdown, 'Блоки та модулі за апдейтом 31.07.26');
    const blocks = {};
    const rowPattern = /^\|\s*([a-zA-Z]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
    let match;
    while ((match = rowPattern.exec(section)) !== null) {
      const key = stripMarkdown(match[1]);
      if (key === 'Ключ') continue;
      blocks[key] = {
        key,
        label: stripMarkdown(match[2]),
        done: firstNumber(match[3]),
        active: firstNumber(match[4]),
        tasks: [stripMarkdown(match[5])]
      };
    }
    return blocks;
  }

  function parseCompactRows(markdown) {
    const section = getSection(markdown, '1. Загальна картина');
    const rows = {};
    const rowPattern = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
    let match;
    while ((match = rowPattern.exec(section)) !== null) {
      const direction = stripMarkdown(match[1]);
      if (direction === 'Напрям' || direction === '---') continue;
      rows[direction] = {
        direction,
        worksection: stripMarkdown(match[2]),
        github: stripMarkdown(match[3])
      };
    }
    return rows;
  }

  function parseCompactPair(text) {
    const match = String(text || '').match(/(\d+)\s*\/\s*(\d+)/);
    return match ? { first: Number(match[1]), second: Number(match[2]) } : { first: 0, second: 0 };
  }

  function countIds(text) {
    const matches = String(text || '').match(/\b\d{7,8}\b/g);
    return matches ? new Set(matches).size : 0;
  }

  function compactModule(key, label, block, done, active) {
    return {
      key,
      label,
      done,
      active,
      tasks: listItems(block)
    };
  }

  function parseCompactModuleBlocks(markdown) {
    const findesk = getSection(markdown, '2. Findesk — за сервісами й типовими блоками');
    const presentation = getSubsection(findesk, 'Presentation / Admin / Finance');
    const notifications = getSubsection(findesk, 'Notifications / Support');
    const common = getSubsection(findesk, 'Common / Email / QA');
    const cicd = getSubsection(findesk, 'CI/CD / Release / Runtime');
    const documents = getSubsection(findesk, 'Документообіг / Agreements / Lending');
    return {
      presentationAdminFinance: compactModule('presentationAdminFinance', 'Presentation / Admin / Finance', presentation, 4, 2),
      notificationsSupport: compactModule('notificationsSupport', 'Notifications / Support', notifications, 3, 2),
      commonEmailQa: compactModule('commonEmailQa', 'Common / Email / QA', common, 4, 1),
      cicdReleaseRuntime: compactModule('cicdReleaseRuntime', 'CI/CD / Release / Runtime', cicd, 13, 2),
      documentAgreementsLending: compactModule('documentAgreementsLending', 'Документообіг / Agreements / Lending', documents, 0, Math.max(12, countIds(documents)))
    };
  }

  function parseCompactReport(markdown, title) {
    const rows = parseCompactRows(markdown);
    const findeskRow = rows.Findesk || { worksection: '', github: '' };
    const worksection = parseCompactPair(findeskRow.worksection);
    const github = parseCompactPair(findeskRow.github);
    const meaning = matchNumber(findeskRow.worksection, /з них\s+(\d+)\s+змістовних/i);
    const findesk = getSection(markdown, '2. Findesk — за сервісами й типовими блоками');
    const findeskItems = listItems(findesk);
    const denysClosed = matchNumber(markdown, /Денис Щипцов:\s+(\d+)\s+задач/i);
    const kiraClosed = matchNumber(markdown, /Кіра Баталова:\s+(\d+)\s+задач/i);
    const pmClosed = matchNumber(markdown, /pm eon\.plus:\s+(\d+)\s+задача/i);
    const denysPr = matchNumber(markdown, /GitHub Findesk-prod:\s+Денис\s+—\s+(\d+)\s+закритих PR/i);
    const kiraPr = matchNumber(markdown, /GitHub Findesk-prod:[^\n]+Кіра\s+—\s+(\d+)/i);
    const conclusions = numberedItems(getSection(markdown, '6. Короткий висновок'));
    const risks = [
      (markdown.match(/PR 3469[^.\n]+(?:\.[^\n]*)?/i) || [])[0],
      (markdown.match(/PR 3459[^.\n]+(?:\.[^\n]*)?/i) || [])[0]
    ].filter(Boolean).map(stripMarkdown);
    const activeItems = [
      ...listItems(getSubsection(findesk, 'Presentation / Admin / Finance')).filter((item) => item.startsWith('В роботі')),
      ...listItems(getSubsection(findesk, 'Notifications / Support')).filter((item) => item.startsWith('В роботі')),
      ...listItems(getSubsection(findesk, 'Common / Email / QA')).filter((item) => item.startsWith('В роботі')),
      ...listItems(getSubsection(findesk, 'CI/CD / Release / Runtime')).filter((item) => item.startsWith('В роботі')),
      ...listItems(getSubsection(findesk, 'Документообіг / Agreements / Lending')).filter((item) => item.startsWith('В роботі'))
    ];

    return {
      title,
      reportDate: '04.08.2026',
      statusDate: '04.08.2026',
      kpis: {
        worksectionClosed: worksection.first,
        worksectionMeaningful: meaning,
        worksectionService: Math.max(0, worksection.first - meaning),
        githubClosedPr: github.first,
        githubDenysPr: denysPr,
        githubKiraPr: kiraPr,
        activeProductTasks: worksection.second,
        openReviewPr: github.second
      },
      stages: [
        { label: 'Виконано у Worksection', valueText: String(worksection.first), value: worksection.first, note: 'Findesk у зведеній таблиці.' },
        { label: 'Виконано у GitHub', valueText: `${github.first} PR`, value: github.first, note: 'Findesk-prod PR у контрольному вікні.' },
        { label: 'В роботі', valueText: `${worksection.second} active`, value: worksection.second, note: 'Активний пул Findesk.' },
        { label: 'Code Review', valueText: `${github.second} PR`, value: github.second, note: 'PR 3469 і PR 3459 залишаються pending.' }
      ],
      people: {
        denys: { label: 'Денис', closed: denysClosed, meaningful: denysClosed, done: findeskItems.filter((item) => item.includes('Денис Щипцов') || item.includes('GitHub Findesk-prod')) },
        kira: { label: 'Кіра', closed: kiraClosed, meaningful: kiraClosed, done: findeskItems.filter((item) => item.includes('Кіра Баталова') || item.includes('GitHub Findesk-prod')) },
        pm: { label: 'pm eon.plus', closed: pmClosed, meaningful: pmClosed, done: [...findeskItems, ...listItems(getSection(markdown, '4. Інші напрями'))].filter((item) => item.includes('pm eon.plus')) }
      },
      githubBlocks: {
        presentation: 3,
        support: 4,
        incomeBook: /Income Book/i.test(markdown) ? 1 : 0,
        glitchTip: /GlitchTip/i.test(markdown) ? 1 : 0,
        release: /PR 3442/i.test(markdown) ? 1 : 0
      },
      moduleBlocks: parseCompactModuleBlocks(markdown),
      active: {
        unassigned: 13,
        oleksandr: 2,
        denys: 4,
        kira: 1,
        items: activeItems
      },
      reviewItems: risks,
      githubDone: listItems(getSection(markdown, '2. Findesk — за сервісами й типовими блоками')).filter((item) => item.startsWith('Виконано')),
      risks,
      conclusions,
      updateTitle: parseUpdateHeading(markdown),
      updateTasks: parseUpdateTasks(markdown)
    };
  }

  function parseUpdateHeading(markdown) {
    const match = markdown.match(/^#{1,2}\s+(Оновлення[^\n]*)$/im);
    if (match) return stripMarkdown(match[1]).trim();
    const date = markdown.match(/^\s*(?:Фіндеск|Findesk)\s+(\d{2}\.\d{2}\.\d{2,4})/im);
    return date ? `Оновлення ${date[1]}` : 'Оновлення';
  }

  function extractTaskDuration(text) {
    const match = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(год(?:ини|ин)?|дн(?:і|ів|і)?|день)/i);
    return match ? `${match[1].replace(',', '.')} ${match[2]}` : 'не вказано';
  }

  function classifyTaskType(task) {
    const text = `${task.title} ${task.status}`.toLowerCase();
    if (/(баг|помил|зауваж|виправлен|bug)/i.test(text)) return 'bug';
    if (/(доопрац|підтрим|наповнен|опис |аналіз|погоджен|тестуван|модерац|інтеграц)/i.test(text)) return 'enhancement';
    return 'new';
  }

  function taskTypeLabel(type) {
    return { bug: 'Баги та помилки', enhancement: 'Допрацювання', new: 'Нова розробка' }[type] || 'Нова розробка';
  }

  function parseUpdateTasks(markdown) {
    let start = markdown.search(/^#{1,2}\s+Оновлення[^\n]*$/im);
    if (start < 0) start = markdown.search(/^\s*={3,10}\s+.+$/m);
    if (start < 0) return [];
    const section = markdown.slice(start).split(/\r?\n/);
    const nextSection = section.slice(1).findIndex((line) => /^#{1,2}\s+/.test(line));
    const lines = nextSection >= 0 ? section.slice(1, nextSection + 1) : section.slice(1);
    const taskLines = [];
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^\s*={3,10}\s+/.test(line) || /^\s*#{1,3}\s+/.test(line)) {
        taskLines.push(line);
        return;
      }
      const continuation = /^-\s*(?:@|дедлайн|https?:\/\/)/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
      if (continuation && taskLines.length && !/^\s*={3,10}\s+/.test(taskLines[taskLines.length - 1])) {
        taskLines[taskLines.length - 1] += ` ${trimmed.replace(/^-\s*/, '')}`;
      } else {
        taskLines.push(line);
      }
    });
    let domain = '';
    return taskLines.reduce((tasks, line) => {
      const heading = line.match(/^\s*(={3,10})\s+(.+?)\s+\1\s*$/) || line.match(/^\s*(={3,10})\s+(.+?)\s*$/);
      if (heading) {
        domain = stripMarkdown(heading[2]).trim();
        return tasks;
      }
      if (!line.trim() || /^\s*#/.test(line)) return tasks;
      const raw = line.replace(/^\s*-\s+/, '').trim();
      const parts = raw.includes('|') ? raw.split('|').map((part) => part.trim()).filter(Boolean) : [raw];
      const naturalText = parts[0] || '';
      const title = naturalText.split(/\s+(?:[-—]\s+)?(?=@|дедлайн|(?:Андрій|Віталій|Віталик|Олександр|Денис|Кіра|Кирило)\b)/i)[0].trim();
      const fields = { title: stripMarkdown(title).replace(/https?:\/\/\S+/gi, '').trim(), domain, service: '', developer: 'не вказано', client: 'не вказано', developerDeadline: 'не вказано', clientDeadline: 'не вказано', duration: 'не вказано', status: 'не вказано' };
      const mentions = [...naturalText.matchAll(/@[A-Za-z][A-Za-z0-9_-]*/g)].map((match) => match[0]);
      if (mentions.length) fields.developer = [...new Set(mentions)].join(', ');
      parts.forEach((part) => {
        const match = part.match(/^([^:]+):\s*(.*)$/);
        if (!match) return;
        const key = match[1].trim().toLowerCase();
        const value = stripMarkdown(match[2].trim());
        if (key === 'розробник') fields.developer = value;
        if (key === 'сервіс' || key === 'service') fields.service = value;
        if (key === 'замовник') fields.client = value;
        if (key === 'дедлайн розробника') fields.developerDeadline = value;
        if (key === 'дедлайн замовника') fields.clientDeadline = value;
        if (key === 'термін' || key === 'тривалість' || key === 'оцінка' || key === 'плановий термін') fields.duration = value;
        if (key === 'статус') fields.status = value;
      });
      if (parts.length === 1) {
        const datePattern = '(\\d{1,2}\\.\\d{1,2}\\.(?:\\d{2,4})?)';
        const developerDeadline = naturalText.match(new RegExp(`дедлайн(?:\\s+(?:розробника|виконавця))?\\s+${datePattern}`, 'i'));
        if (developerDeadline) fields.developerDeadline = developerDeadline[1];
        fields.duration = extractTaskDuration(naturalText);
        const personPattern = /(?:Андрій|Віталій|Віталик|Олександр|Денис|Кіра|Кирило)(?:\s+[А-ЯІЇЄҐ][а-яіїєґ]+){1,2}/gi;
        const clients = [...naturalText.matchAll(personPattern)];
        if (clients.length) {
          fields.client = [...new Set(clients.map((match) => match[0].trim()))].join(', ');
          const lastClient = clients[clients.length - 1];
          const clientDeadline = naturalText.slice(lastClient.index + lastClient[0].length).match(new RegExp(datePattern));
          if (clientDeadline) fields.clientDeadline = clientDeadline[1];
        }
        const hasNoFeedback = /фідбеку\s+немає/i.test(naturalText);
        const hasOpenQuestion = /питання\s+відкрите/i.test(naturalText);
        if (hasNoFeedback && hasOpenQuestion) fields.status = 'питання відкрите · не має фідбеку';
        else if (hasNoFeedback) fields.status = 'не має фідбеку';
        else if (hasOpenQuestion) fields.status = 'питання відкрите';
        else if (/не\s+встиг/i.test(naturalText)) fields.status = 'не встиг';
        else if (/статус\s*\?/i.test(naturalText)) fields.status = 'не визначено';
      }
      if (fields.title) tasks.push({ ...fields, type: classifyTaskType(fields) });
      return tasks;
    }, []);
  }

  function parseClientTwoReport(markdown) {
    const lines = markdown.split(/\r?\n/);
    const tones = ['cyan', 'blue', 'violet', 'amber', 'green', 'red'];
    const blocks = [];
    const tasks = [];
    let block = null;
    let service = null;
    let category = null;
    let serviceDepth = 0;
    let currentTask = null;
    let taskIndent = 0;

    const cleanHeading = (value) => stripMarkdown(value.replace(/^\s*\d+\.\s*/, '').trim());
    const ensureTask = (title) => {
      if (!title || !block || !service) return null;
      currentTask = { title: stripMarkdown(title).trim(), block: block.name, service: service.name, status: 'інформація відсутня', developer: 'інформація відсутня', deadline: 'інформація відсутня', source: 'інформація відсутня' };
      tasks.push(currentTask);
      service.tasks.push(currentTask);
      return currentTask;
    };
    const addService = (name, depth) => {
      if (!block) return null;
      service = { name: cleanHeading(name), children: [], tasks: [] };
      block.services.push(service);
      serviceDepth = depth;
      return service;
    };

    lines.forEach((line) => {
      const heading = line.match(/^(#{2,4})\s+(.+?)\s*$/);
      if (heading) {
        const depth = heading[1].length;
        const name = cleanHeading(heading[2]);
        currentTask = null;
        const isNumberedBlock = /^\d{1,2}\./.test(heading[2].trim());
        if (depth === 2 || isNumberedBlock) {
          block = { name, tone: tones[blocks.length % tones.length], services: [] };
          blocks.push(block);
          service = null;
          category = null;
        } else if (depth === 3) {
          service = addService(name, depth);
          category = block.name.includes('Бізнес-домени') ? service : null;
        } else if (depth === 4 && block?.name.includes('Бізнес-домени')) {
          if (!category) category = addService('Інші сервіси', 3);
          const child = { name, tasks: [] };
          category.children.push(child);
          service = child;
          serviceDepth = depth;
        }
        return;
      }
      if (!block || !service) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      const namedTask = trimmed.match(/^-\s*Назва задачі:\s*(.+)$/i);
      if (namedTask) {
        ensureTask(namedTask[1]);
        return;
      }
      const numberedTask = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numberedTask && !/^\d+\.\d+/.test(numberedTask[1])) {
        ensureTask(numberedTask[1]);
        taskIndent = line.search(/\S/);
        return;
      }
      if (!currentTask || line.search(/\S/) < taskIndent) return;
      const field = trimmed.match(/^[-*]\s*([^:]+):\s*(.+)$/);
      if (!field) return;
      const key = field[1].trim().toLowerCase();
      const value = stripMarkdown(field[2].trim());
      if (key === 'статус') currentTask.status = value;
      if (key === 'виконавець' || key === 'виконавці') currentTask.developer = value;
      if (key === 'дедлайн' || key === 'планова дата виконання') currentTask.deadline = value;
      if (key === 'джерело') currentTask.source = value;
    });

    const structure = blocks.map((item) => ({ name: item.name, tone: item.tone, services: item.services.map((itemService) => ({ name: itemService.name, children: itemService.children.map((child) => child.name), tasks: itemService.tasks })) }));
    return { title: (markdown.match(/^#\s+(.+)$/m)?.[1] || 'Замовник 2').trim(), blocks: structure, tasks };
  }

  function parseDailyReport(markdown) {
    const titleMatch = markdown.match(/^#\s+(.+)$/m) || markdown.match(/^\s*(?:Фіндеск|Findesk)\s+[^\n]+/im);
    const title = stripMarkdown(titleMatch ? titleMatch[1] || titleMatch[0].trim() : 'Findesk daily report').replace(/^Фіндеск(?=\s|$)/i, 'Findesk');
    if (/Компактний зведений звіт/i.test(title)) {
      return parseCompactReport(markdown, title);
    }
    const dates = title.match(/за\s+(\d{2}\.\d{2}\.\d{4}).*на\s+(\d{2}\.\d{2}\.\d{4})/);
    const completedWorksection = getSection(markdown, 'Виконано 04.08.2026 — Worksection');
    const completedGithub = getSection(markdown, 'Виконано 04.08.2026 — GitHub');
    const active = getSection(markdown, 'Зараз у роботі — Worksection, у розрізі виконавців');
    const review = getSection(markdown, 'Code Review — відкриті GitHub PR');
    const conclusions = getSection(markdown, 'Висновки');

    const risks = [];
    const pr3459 = (markdown.match(/PR #3459[^\n]+/i) || [])[0];
    const pr3469 = (markdown.match(/PR #3469[^\n]+/i) || [])[0];
    if (pr3459) risks.push(stripMarkdown(pr3459));
    if (pr3469) risks.push(stripMarkdown(pr3469));
    const unassignedRisk = (numberedItems(conclusions).find((item) => item.includes('9 продуктових задач')) || '').trim();
    if (unassignedRisk) risks.push(unassignedRisk);

    return {
      title,
      reportDate: dates ? dates[1] : '',
      statusDate: dates ? dates[2] : '',
      kpis: {
        worksectionClosed: matchNumber(markdown, /Worksection[^\n]+закрито\s+(\d+)\s+запис/i),
        worksectionMeaningful: matchNumber(markdown, /закрито\s+\d+\s+записів:\s+(\d+)\s+змістовних/i),
        worksectionService: matchNumber(markdown, /\d+\s+змістовних задач і\s+(\d+)\s+службових/i),
        githubClosedPr: matchNumber(markdown, /GitHub[^\n]+закрито\s+(\d+)\s+pull request/i),
        githubDenysPr: matchNumber(markdown, /(\d+)\s+авторства Denys-devit/i),
        githubKiraPr: matchNumber(markdown, /(\d+)\s+авторства batalova-kira/i),
        activeProductTasks: matchNumber(markdown, /В роботі\s*\|\s*(\d+)\s+продуктових задач/i),
        openReviewPr: matchNumber(markdown, /відкриті\s+(\d+)\s+pull request/i)
      },
      stages: parseStageRows(markdown),
      people: {
        denys: {
          label: 'Денис',
          closed: matchNumber(markdown, /Денис:\s+(\d+)\s+закриті записи/i),
          meaningful: matchNumber(markdown, /Денис:\s+\d+\s+закриті записи, з них\s+(\d+)\s+змістовних/i),
          done: listItems(getSubsection(completedWorksection, 'Денис'))
        },
        kira: {
          label: 'Кіра',
          closed: matchNumber(markdown, /Кіра:\s+(\d+)\s+закриті записи/i),
          meaningful: matchNumber(markdown, /Кіра:\s+\d+\s+закриті записи, з них\s+(\d+)\s+змістовні/i),
          done: listItems(getSubsection(completedWorksection, 'Кіра'))
        },
        pm: {
          label: 'pm eon.plus',
          closed: matchNumber(markdown, /pm eon\.plus:\s+(\d+)\s+закритий запис/i),
          meaningful: 0,
          done: listItems(getSubsection(completedWorksection, 'pm eon.plus'))
        }
      },
      githubBlocks: {
        presentation: matchNumber(markdown, /Presentation та admin-прототип\s+—\s+(\d+)\s+закритих PR/i),
        support: matchNumber(markdown, /Support та Notifications\s+—\s+(\d+)\s+закритих PR/i),
        incomeBook: /Income Book\s+—/.test(markdown) ? 1 : 0,
        glitchTip: /GlitchTip\s+—/.test(markdown) ? 1 : 0,
        release: /Release\/staging\s+—/.test(markdown) ? 1 : 0
      },
      moduleBlocks: parseModuleBlocks(markdown),
      active: {
        unassigned: matchNumber(markdown, /Без призначеного виконавця\s+—\s+(\d+)\s+продуктових задач/i),
        oleksandr: matchNumber(markdown, /Олександр Янчук\s+—\s+(\d+)\s+задач/i),
        denys: matchNumber(markdown, /Денис\s+—\s+(\d+)\s+задача/i),
        kira: matchNumber(markdown, /Кіра\s+—\s+(\d+)\s+задача/i),
        items: listItems(active)
      },
      reviewItems: listItems(review),
      githubDone: listItems(completedGithub),
      risks,
      conclusions: numberedItems(conclusions),
      updateTitle: parseUpdateHeading(markdown),
      updateTasks: parseUpdateTasks(markdown)
    };
  }

  function buildInsightCards(report) {
    const firstRisk = report.risks[0] || 'Немає зафіксованого ризику.';
    return {
      kpis: {
        worksection: {
          title: 'Worksection',
          body: `${report.kpis.worksectionClosed} закритих записів: ${report.kpis.worksectionMeaningful} змістовних і ${report.kpis.worksectionService} службових. Змістовні записи краще дивитись окремо від повторних CI/PR-дій.`
        },
        github: {
          title: 'GitHub',
          body: `${report.kpis.githubClosedPr} закритих PR: ${report.kpis.githubDenysPr} Denys-devit і ${report.kpis.githubKiraPr} batalova-kira. Це технічне підтвердження руху, не 1:1 із Worksection.`
        },
        active: {
          title: 'В роботі',
          body: `${report.kpis.activeProductTasks} продуктових задач активні. З них ${report.active.unassigned} без виконавця, ${report.active.oleksandr} у Олександра, ${report.active.denys} у Дениса, ${report.active.kira} у Кіри.`
        },
        review: {
          title: 'Code Review',
          body: `${report.kpis.openReviewPr} відкриті PR. Головний сигнал: ${firstRisk}`
        }
      },
      modules: Object.values(report.moduleBlocks || {}).map((module) => ({
        title: module.label,
        body: `${module.done} виконано, ${module.active} в роботі. ${module.tasks.join(' ')}`
      })),
      stages: report.stages.map((stage) => ({
        title: stage.label,
        body: `${stage.valueText || stage.value}. ${stage.note}`
      })),
      riskAction: 'Натисни на ризик, щоб зафіксувати підказку.'
    };
  }

  function buildViewModels(report) {
    const moduleCards = Object.values(report.moduleBlocks || {})
      .map((module) => ({
        key: module.key,
        label: module.label,
        done: module.done,
        active: module.active,
        total: module.done + module.active,
        summary: module.tasks.join(' ')
      }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'uk'));
    const doneItems = [...report.people.denys.done, ...report.people.kira.done, ...report.githubDone];
    const activeItems = report.active.items;
    const reviewItems = report.reviewItems;
    const riskItems = report.risks;
    const topModules = moduleCards.slice(0, 4);

    return {
      modulesMap: {
        cards: moduleCards
      },
      kanban: {
        columns: [
          { key: 'done', label: 'Виконано', count: doneItems.length, items: doneItems },
          { key: 'active', label: 'В роботі', count: activeItems.length, items: activeItems },
          { key: 'review', label: 'Code Review', count: reviewItems.length, items: reviewItems },
          { key: 'risk', label: 'Ризики', count: riskItems.length, items: riskItems }
        ]
      },
      executive: {
        headline: `${report.kpis.githubClosedPr} GitHub PR, ${report.kpis.worksectionClosed} Worksection-записів і ${report.kpis.activeProductTasks} активних продуктових задач за ${report.reportDate}.`,
        topModules,
        actions: [
          `${report.active.unassigned} задач без виконавця потребують призначення.`,
          `${report.kpis.openReviewPr} PR залишаються в Code Review.`,
          report.risks[0] || 'Критичних ризиків у звіті не зафіксовано.'
        ]
      }
    };
  }

  function buildArchitectureViewModels(structure, report) {
    const merged = mergeStructureWithReport(structure, report);
    const byKey = new Map(merged.services.map((service) => [service.key, service]));
    const connected = new Map();
    merged.flows.forEach((flow) => {
      flow.steps.forEach((step) => {
        const service = byKey.get(step);
        if (!service) return;
        if (!connected.has(service.key)) connected.set(service.key, new Set());
        flow.steps.forEach((otherStep) => {
          if (otherStep !== step && byKey.has(otherStep)) connected.get(service.key).add(otherStep);
        });
      });
    });
    const services = merged.services.map((service) => ({
        ...service,
        related: [...(connected.get(service.key) || [])]
      }));
    return { ...merged, services, byKey: new Map(services.map((service) => [service.key, service])) };
  }

  function buildDeveloperMenus(report) {
    return Object.values(report.people || {}).map((person) => ({
      key: person.label,
      label: person.label,
      closed: person.closed,
      meaningful: person.meaningful,
      items: person.done || []
    }));
  }

  function normalizeTheme(theme) {
    return theme === 'dark' || theme === 'light' ? theme : null;
  }

  function resolveInitialTheme(savedTheme, prefersDark) {
    return normalizeTheme(savedTheme) || (prefersDark ? 'dark' : 'light');
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat('uk-UA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function insightButton(title, body) {
    return `<button class="info-trigger" type="button" aria-label="Показати деталі: ${escapeHtml(title)}" aria-expanded="false">
      <span>i</span>
      <div class="info-popover" role="tooltip">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
    </button>`;
  }

  function renderBars(container, items, maxValue) {
    container.innerHTML = items.map((item) => {
      const width = maxValue ? Math.max(4, Math.round((item.value / maxValue) * 100)) : 0;
      const insight = (window.currentInsights?.stages || []).find((stage) => stage.title === item.label);
      return `<div class="bar-line">
        <div class="bar-line__top"><span>${item.label}</span><strong>${item.valueText || item.value}</strong>${insight ? insightButton(insight.title, insight.body) : ''}</div>
        <div class="bar-track"><span style="width:${width}%"></span></div>
        <p>${item.note || ''}</p>
      </div>`;
    }).join('');
  }

  function renderDonut(report) {
    const chart = document.getElementById('donut-chart');
    const legend = document.getElementById('github-legend');
    const moduleBlocks = Object.values(report.moduleBlocks || {});
    const palette = ['#13a884', '#4f7cff', '#f0a536', '#d95f76', '#6b7280', '#7c5cff', '#1d9aaa'];
    const blocks = moduleBlocks.length
      ? moduleBlocks.map((module, index) => [module.label, module.done + module.active, palette[index % palette.length]])
      : [
        ['Presentation/admin', report.githubBlocks.presentation, '#13a884'],
        ['Support/Notifications', report.githubBlocks.support, '#f0a536'],
        ['Income Book', report.githubBlocks.incomeBook, '#4f7cff'],
        ['GlitchTip', report.githubBlocks.glitchTip, '#d95f76'],
        ['Release/staging', report.githubBlocks.release, '#6b7280']
      ];
    const visibleBlocks = blocks.filter(([, value]) => value > 0);
    const total = visibleBlocks.reduce((sum, [, value]) => sum + value, 0) || 1;
    let offset = 0;
    const gradient = visibleBlocks.map(([, value, color]) => {
      const start = offset;
      offset += (value / total) * 100;
      return `${color} ${start}% ${offset}%`;
    }).join(', ');

    chart.style.background = `conic-gradient(${gradient})`;
    chart.innerHTML = `<div><strong>${total}</strong><span>${moduleBlocks.length ? 'задач у модулях' : 'PR у блоках'}</span></div>`;
    legend.innerHTML = visibleBlocks.map(([label, value, color]) => {
      const module = moduleBlocks.find((item) => item.label === label);
      const info = module ? insightButton(label, `${module.done} виконано, ${module.active} в роботі. ${module.tasks.join(' ')}`) : '';
      return `<li><span style="background:${color}"></span><strong>${value}</strong>${escapeHtml(label)}${info}</li>`;
    }).join('');
  }

  function renderPeople(report) {
    const container = document.getElementById('people-bars');
    const people = buildDeveloperMenus(report);
    const max = Math.max(...people.map((person) => person.closed), 1);
    container.innerHTML = people.map((person) => {
      const closedWidth = Math.round((person.closed / max) * 100);
      const meaningfulWidth = person.closed ? Math.round((person.meaningful / person.closed) * 100) : 0;
      const list = person.items.length
        ? person.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        : '<li>У звіті немає деталізованих задач.</li>';
      return `<div class="person-row has-popover" tabindex="0" aria-expanded="false">
        <div><strong>${escapeHtml(person.label)}</strong><span>${person.closed} закрито · ${person.meaningful} змістовні</span></div>
        <div class="person-meter"><span style="width:${closedWidth}%"><i style="width:${meaningfulWidth}%"></i></span></div>
        <div class="developer-popover info-popover" role="tooltip">
          <strong>${escapeHtml(person.label)} · задачі</strong>
          <ul>${list}</ul>
        </div>
      </div>`;
    }).join('');
  }

  function renderRisks(report) {
    const container = document.getElementById('risk-list');
    const action = window.currentInsights?.riskAction || 'Натисни на ризик, щоб зафіксувати підказку.';
    container.innerHTML = report.risks.map((risk, index) => `<article class="has-popover" tabindex="0">
      <span></span>
      <p>${escapeHtml(risk)}</p>
      <div class="info-popover info-popover--risk" role="tooltip">
        <strong>Ризик ${index + 1}</strong>
        <p>${escapeHtml(action)}</p>
      </div>
    </article>`).join('');
  }

  function attachPopovers() {
    document.querySelectorAll('.info-trigger, .has-popover').forEach((element) => {
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = element.classList.toggle('is-open');
        element.setAttribute('aria-expanded', String(isOpen));
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.is-open').forEach((element) => {
        element.classList.remove('is-open');
        element.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function renderTasks(report, tab = 'done') {
    const container = document.getElementById('task-list');
    const data = {
      done: [...report.people.denys.done, ...report.people.kira.done, ...report.githubDone],
      active: report.active.items,
      review: report.reviewItems
    }[tab] || [];

    container.innerHTML = data.length
      ? `<ul>${data.map((item) => `<li>${item}</li>`).join('')}</ul>`
      : '<p class="empty">У цьому розділі немає записів.</p>';
  }

  function renderModulesMap(viewModels) {
    const container = document.getElementById('modules-map');
    const max = Math.max(...viewModels.modulesMap.cards.map((card) => card.total), 1);
    container.innerHTML = viewModels.modulesMap.cards.map((card) => {
      const intensity = Math.max(8, Math.round((card.total / max) * 100));
      return `<article class="module-card" style="--intensity:${intensity}%">
        <div class="module-card__top">
          <strong>${escapeHtml(card.label)}</strong>
          ${insightButton(card.label, card.summary)}
        </div>
        <div class="module-card__numbers">
          <span><b>${card.done}</b> виконано</span>
          <span><b>${card.active}</b> в роботі</span>
        </div>
        <div class="module-card__meter"><span style="width:${intensity}%"></span></div>
        <p>${escapeHtml(card.summary)}</p>
      </article>`;
    }).join('');
  }

  function renderKanban(viewModels) {
    const container = document.getElementById('kanban-board');
    container.innerHTML = viewModels.kanban.columns.map((column) => `<section class="kanban-column kanban-column--${column.key}">
      <header><span>${escapeHtml(column.label)}</span><strong>${column.count}</strong></header>
      <div>
        ${column.items.map((item) => `<article>${escapeHtml(item)}</article>`).join('') || '<p class="empty">Немає записів.</p>'}
      </div>
    </section>`).join('');
  }

  function renderExecutive(viewModels, report) {
    const container = document.getElementById('executive-summary');
    container.innerHTML = `<section class="executive-hero">
      <p>${escapeHtml(viewModels.executive.headline)}</p>
      <div>
        <strong>${report.kpis.githubClosedPr}</strong><span>PR закрито</span>
        <strong>${report.kpis.openReviewPr}</strong><span>PR в review</span>
        <strong>${report.active.unassigned}</strong><span>без виконавця</span>
      </div>
    </section>
    <section class="executive-grid">
      <article>
        <h3>Топ модулі</h3>
        <ol>
          ${viewModels.executive.topModules.map((module) => `<li><span>${escapeHtml(module.label)}</span><strong>${module.total}</strong></li>`).join('')}
        </ol>
      </article>
      <article>
        <h3>Що зробити далі</h3>
        <ul>
          ${viewModels.executive.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}
        </ul>
      </article>
    </section>`;
  }

  function serviceStatusLabel(status) {
    return { active: 'в роботі', 'в роботі': 'в роботі', review: 'review', ризик: 'ризик', 'є виконані': 'є виконані', 'немає активності': 'немає активності' }[status] || status;
  }

  function serviceStatusClass(status) {
    return { 'в роботі': 'active', 'є виконані': 'done', 'немає активності': 'idle' }[status] || status;
  }

  function renderServiceDetail(service, model) {
    const detail = document.getElementById('service-detail');
    const overlay = document.getElementById('service-detail-overlay');
    if (!detail || !overlay) return;
    overlay.hidden = false;
    const related = service.related.map((key) => model.byKey.get(key)?.label || key);
    const status = systemStatus(service);
    const flow = model.flows.find((item) => item.steps.includes(service.key));
    const flowSteps = flow ? flow.steps.slice(0, 4) : [];
    detail.innerHTML = `<button class="service-detail__close" type="button" data-detail-close aria-label="Закрити деталі">×</button>
      <div class="detail-kicker">Вибраний сервіс</div>
      <h3 class="detail-service-name">${escapeHtml(service.label)}</h3>
      <span class="system-status system-status--${status.key}"><i></i>${escapeHtml(status.label)}</span>
      <p>${escapeHtml(service.description || 'Опис відсутній у структурі.')}</p>
      <dl class="detail-facts"><div><dt>Рівень</dt><dd>${escapeHtml(service.domain)}</dd></div><div><dt>Пов’язано сервісів</dt><dd>${related.length}</dd></div></dl>
      <h4>Активність</h4>
      <div class="detail-stats"><span><b>${service.done}</b> виконано</span><span><b>${service.active}</b> в роботі</span><span><b>${service.pr}</b> PR</span></div>
      <h4>Залежності</h4>
      <p>${related.length ? related.map(escapeHtml).join(' · ') : 'Зв’язки не визначені.'}</p>
      ${flowSteps.length ? `<h4>Міні-потік</h4><div class="mini-flow">${flowSteps.map((step) => `<span>${escapeHtml(model.byKey.get(step)?.label || step)}</span>`).join('<b>→</b>')}</div>` : ''}
      <h4>Задачі та сигнали</h4>
      <ul>${service.tasks.length ? service.tasks.slice(0, 3).map((task) => `<li>${escapeHtml(task)}</li>`).join('') : '<li>У поточному звіті немає задач.</li>'}</ul>`;
  }

  function systemStatus(service) {
    if (service.status === 'ризик') return { key: 'attention', label: 'Увага' };
    if (service.status === 'в роботі' || service.status === 'review') return { key: 'review', label: 'Потребує уваги' };
    return { key: 'healthy', label: 'Стабільно' };
  }

  function shouldOpenServiceDetail(eventType) {
    return eventType === 'dblclick';
  }

  function closeServiceDetail() {
    const overlay = document.getElementById('service-detail-overlay');
    if (overlay) overlay.hidden = true;
  }

  function systemServiceRole(service) {
    const roles = {
      'frontend-nextjs': 'інтерфейс',
      admin: 'адмінпанель',
      lending: 'ресурсний центр',
      'lending-api': 'API gateway',
      'websocket-server': 'realtime',
      auth: 'авторизація',
      'office-user': 'профіль користувача',
      'main-orchestrator': 'координація запитів',
      'document-flow': 'документообіг',
      'documents-reports': 'звіти та документи',
      income_accounting_book_report: 'облік',
      calculation_ep: 'розрахунки',
      notifications: 'сповіщення',
      credit_system: 'кредитний домен',
      way4pay: 'платежі',
      'shared/': 'спільні бібліотеки'
    };
    return roles[service.key] || service.domain;
  }

  function buildSystemMapViewModel(model) {
    const byKey = new Map(model.services.map((service) => [service.key, service]));
    const attentionServices = model.services.filter((service) => service.status === 'ризик');
    return {
      metrics: {
        services: model.services.length,
        levels: model.levels.length,
        flows: model.flows.length,
        attention: attentionServices.length
      },
      levels: model.levels.map((level, index) => {
        const services = level.services.map((item) => byKey.get(item.key)).filter(Boolean);
        const statusCounts = services.reduce((counts, service) => {
          const key = systemStatus(service).key;
          counts[key] += 1;
          counts.total += 1;
          return counts;
        }, { healthy: 0, review: 0, attention: 0, total: 0 });
        return { ...level, services, statusCounts, expanded: index === 0 || index === 2 };
      })
    };
  }

  function renderSystemMap(model, filter = 'all', query = '', relatedOnly = false) {
    const container = document.getElementById('system-map');
    if (!container) return;
    const view = buildSystemMapViewModel(model);
    const byKey = new Map(model.services.map((service) => [service.key, service]));
    if (!window.systemMapExpanded) window.systemMapExpanded = new Set(view.levels.filter((level) => level.expanded).map((level) => level.id));
    const normalizedQuery = query.toLowerCase().trim();
    const selected = window.architectureSelection;
    const matches = (service) => {
      const haystack = [service.label, service.key, service.domain, service.description, ...service.tasks].join(' ').toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
      if (filter === 'active' && service.active < 1) return false;
      if (filter === 'pr' && service.pr < 1) return false;
      if (filter === 'risk' && service.status !== 'ризик') return false;
      if (relatedOnly && selected && service.key !== selected && !byKey.get(selected)?.related.includes(service.key)) return false;
      return true;
    };
    container.innerHTML = view.levels.map((level) => {
      const services = level.services.filter(matches);
      if (!services.length) return '';
      const isExpanded = window.systemMapExpanded.has(level.id);
      const statusCounts = services.reduce((counts, service) => { counts[systemStatus(service).key] += 1; return counts; }, { healthy: 0, review: 0, attention: 0 });
      return `<section class="map-level${isExpanded ? ' is-expanded' : ''}" data-level="${escapeHtml(level.id)}">
        <button class="map-level__toggle" type="button" data-level-toggle="${escapeHtml(level.id)}" aria-expanded="${isExpanded}">
          <span class="map-level__chevron" aria-hidden="true">${isExpanded ? '⌄' : '›'}</span><span class="map-level__index">${String(level.id).replace('level-', '0')}</span><h3>${escapeHtml(level.title)}</h3><strong>${services.length}</strong>
          <span class="level-statuses"><i class="system-dot system-dot--healthy"></i>${statusCounts.healthy}<i class="system-dot system-dot--review"></i>${statusCounts.review}<i class="system-dot system-dot--attention"></i>${statusCounts.attention}</span><span class="map-level__open" aria-hidden="true">›</span>
        </button>
        <div class="map-level__body" ${isExpanded ? '' : 'hidden'}>
          <div class="service-table__head"><span>Сервіс</span><span>Роль у системі</span><span>Стан</span><span>Залежності</span></div>
          ${services.map((service) => { const status = systemStatus(service); const related = service.related.map((key) => byKey.get(key)?.label || key); return `<button class="service-row${selected === service.key ? ' is-selected' : ''}" type="button" data-service-key="${escapeHtml(service.key)}"><span class="service-row__name">${escapeHtml(service.label)}</span><span>${escapeHtml(systemServiceRole(service))}</span><span class="system-status system-status--${status.key}"><i></i>${escapeHtml(status.label)}</span><span class="service-row__related">${related.length ? escapeHtml(related.slice(0, 3).join(', ')) : '—'}</span><span class="service-row__arrow" aria-hidden="true">›</span></button>`; }).join('')}
        </div>
      </section>`;
    }).join('') || '<p class="empty">За цим фільтром сервісів не знайдено.</p>';
    container.querySelectorAll('[data-level-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const levelId = button.dataset.levelToggle;
        if (window.systemMapExpanded.has(levelId)) window.systemMapExpanded.delete(levelId); else window.systemMapExpanded.add(levelId);
        renderSystemMap(model, window.architectureFilter, window.architectureQuery, window.architectureRelatedOnly);
      });
    });
    container.querySelectorAll('[data-service-key]').forEach((button) => {
      button.addEventListener('click', () => {
        window.architectureSelection = button.dataset.serviceKey;
        container.querySelectorAll('[data-service-key]').forEach((item) => item.classList.toggle('is-selected', item === button));
        closeServiceDetail();
      });
      button.addEventListener('dblclick', () => {
        if (shouldOpenServiceDetail('dblclick')) renderServiceDetail(model.byKey.get(button.dataset.serviceKey), model);
      });
    });
  }

  function renderServiceMatrix(model, mode = 'all', sort = false) {
    const body = document.getElementById('service-matrix-body');
    if (!body) return;
    let services = [...model.services];
    if (mode === 'changes') services = services.filter((service) => service.done || service.active || service.pr || service.status === 'ризик');
    if (sort) services.sort((a, b) => (b.active + b.done + b.pr) - (a.active + a.done + a.pr));
    body.innerHTML = services.map((service) => `<tr data-matrix-key="${escapeHtml(service.key)}"><td>${escapeHtml(service.domain)}</td><td><button class="matrix-service-button" type="button" data-matrix-service="${escapeHtml(service.key)}">${escapeHtml(service.label)}</button></td><td>${escapeHtml(service.description || '—')}</td><td>${service.done}</td><td>${service.active}</td><td>${service.pr}</td><td><span class="status-pill status-pill--${escapeHtml(serviceStatusClass(service.status))}">${escapeHtml(serviceStatusLabel(service.status))}</span></td><td>${service.related.length ? service.related.map((key) => escapeHtml(model.byKey.get(key)?.label || key)).join(', ') : '—'}<div class="matrix-tasks">${service.tasks.length ? service.tasks.map((task) => `<p>${escapeHtml(task)}</p>`).join('') : '<p>Немає задач у звіті.</p>'}</div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Немає сервісів.</td></tr>';
    body.querySelectorAll('[data-matrix-service]').forEach((button) => {
      button.addEventListener('click', () => button.closest('tr').classList.toggle('is-expanded'));
    });
  }

  function renderFlowDetail(flow, step, model) {
    const detail = document.getElementById('flow-detail');
    if (!detail) return;
    const service = model.byKey.get(step);
    detail.innerHTML = `<div class="detail-kicker">${escapeHtml(flow.label)}</div><h3>${escapeHtml(step)}</h3><p>${escapeHtml(service?.description || 'Цей крок описаний у структурі як частина потоку.')}</p><div class="detail-stats"><span><b>${service?.done || 0}</b> виконано</span><span><b>${service?.active || 0}</b> в роботі</span><span><b>${service?.pr || 0}</b> PR</span></div>${service?.tasks?.length ? `<ul>${service.tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join('')}</ul>` : '<p>У звіті немає окремих задач для цього кроку.</p>'}`;
  }

  function renderDataFlows(model) {
    const container = document.getElementById('data-flows-list');
    if (!container) return;
    container.innerHTML = model.flows.map((flow) => `<article class="flow-card"><header><span>${escapeHtml(flow.label)}</span><strong>${flow.steps.length} кроків</strong></header><div class="flow-steps">${flow.steps.map((step, index) => `<button type="button" class="flow-step" data-flow-key="${escapeHtml(flow.key)}" data-flow-step="${escapeHtml(step)}"><i>${index + 1}</i><span>${escapeHtml(step)}</span></button>`).join('<b class="flow-arrow">→</b>')}</div></article>`).join('');
    container.querySelectorAll('[data-flow-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const flow = model.flows.find((item) => item.key === button.dataset.flowKey);
        renderFlowDetail(flow, button.dataset.flowStep, model);
      });
    });
  }

  function updateTaskStatusClass(status) {
    const normalized = status.toLowerCase();
    if (normalized.includes('фідбек')) return 'no-feedback';
    if (normalized.includes('питання') || normalized.includes('не встиг')) return 'attention';
    if (normalized === 'не визначено' || normalized === 'не вказано') return 'muted';
    return 'active';
  }

  function deadlineSignal(tasks, field) {
    const dates = tasks.map((task) => task[field]).filter((value) => value && value !== 'не вказано').map((value) => {
      const parts = value.split('.').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
      return new Date(parts[2] < 100 ? 2000 + parts[2] : parts[2], parts[1] - 1, parts[0]);
    }).filter(Boolean);
    if (!dates.length) return { key: 'muted', label: 'Дедлайн не вказано' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.min(...dates.map((date) => Math.round((date - today) / 86400000)));
    if (days === 1) return { key: 'warning', label: 'До дедлайну один день' };
    if (days <= 0) return { key: 'overdue', label: 'Дедлайн минув або сьогодні' };
    return { key: 'healthy', label: 'Дедлайн попереду' };
  }

  function parseUpdateDate(value) {
    if (!value || value === 'не вказано' || !/^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})$/.test(value)) return null;
    const [day, month, rawYear] = value.split('.').map(Number);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function taskDeadlineState(task) {
    const dates = [parseUpdateDate(task.developerDeadline), parseUpdateDate(task.clientDeadline)].filter(Boolean);
    if (!dates.length) return { key: 'muted', label: 'Дедлайн не вказано' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.min(...dates.map((date) => Math.round((date - today) / 86400000)));
    if (days === 1) return { key: 'warning', label: 'Дедлайн завтра' };
    if (days <= 0) return { key: 'overdue', label: 'Протерміновано' };
    return { key: 'healthy', label: 'В роботі' };
  }

  function updateModeStats(tasks) {
    const developers = [...new Set(tasks.flatMap((task) => task.developer.split(',').map((value) => value.trim()).filter((value) => value.startsWith('@'))))];
    const overdue = tasks.filter((task) => taskDeadlineState(task).key === 'overdue');
    const warning = tasks.filter((task) => taskDeadlineState(task).key === 'warning');
    const noFeedback = tasks.filter((task) => task.status.includes('фідбек')).length;
    const questions = tasks.filter((task) => task.status.includes('питання')).length;
    return { developers, overdue, warning, noFeedback, questions };
  }

  function updateTaskLine(task) {
    const state = taskDeadlineState(task);
    return `<details class="update-task-card update-task-card--${state.key}"><summary><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(state.label)}</small></summary><div class="update-task-card__detail"><span>${escapeHtml(task.domain)}</span><p>${escapeHtml(task.status)}</p><p>${escapeHtml(task.developer)} · ${escapeHtml(task.client)}</p></div></details>`;
  }

  function renderUpdateDashboard(report) {
    const tasks = report.updateTasks || [];
    const stats = updateModeStats(tasks);
    document.querySelector('#github-title')?.replaceChildren(document.createTextNode('Задачі за блоками'));
    document.querySelector('#people-title')?.replaceChildren(document.createTextNode('Далі — деталізація'));
    document.querySelector('#tasks-title')?.replaceChildren(document.createTextNode('Задачі апдейту'));
    document.querySelector('[aria-labelledby="github-title"] .eyebrow')?.replaceChildren(document.createTextNode('Розподіл'));
    document.querySelector('[aria-labelledby="people-title"] .eyebrow')?.replaceChildren(document.createTextNode('Деталі'));
    const configureCollapsedSection = (selector, label) => {
      const section = document.querySelector(selector);
      const heading = section?.querySelector('.section-heading');
      if (!section || !heading) return;
      section.classList.add('update-collapsible-section', 'is-collapsed');
      let toggle = heading.querySelector('[data-update-section-toggle]');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'section-collapse-toggle';
        toggle.dataset.updateSectionToggle = 'true';
        toggle.title = `Розгорнути: ${label}`;
        heading.append(toggle);
        toggle.addEventListener('click', () => {
          const collapsed = section.classList.toggle('is-collapsed');
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.title = `${collapsed ? 'Розгорнути' : 'Згорнути'}: ${label}`;
        });
      }
      toggle.setAttribute('aria-expanded', 'false');
    };
    configureCollapsedSection('[aria-labelledby="risk-title"]', 'Що потребує уваги');
    configureCollapsedSection('[aria-labelledby="tasks-title"]', 'Задачі апдейту');

    const palette = ['#13a884', '#4f7cff', '#f0a536', '#d95f76', '#7c5cff', '#1d9aaa', '#6b7280'];
    const byDomain = [...new Map(tasks.map((task) => [task.domain, tasks.filter((item) => item.domain === task.domain)])).entries()];
    const chart = document.getElementById('donut-chart');
    const legend = document.getElementById('github-legend');
    let offset = 0;
    const total = tasks.length || 1;
    const gradient = byDomain.map(([domain, items], index) => { const start = offset; offset += (items.length / total) * 100; return `${palette[index % palette.length]} ${start}% ${offset}%`; }).join(', ');
    chart.style.background = `conic-gradient(${gradient})`;
    chart.innerHTML = `<div><strong>${tasks.length}</strong><span>задач в апдейті</span></div>`;
    legend.innerHTML = byDomain.map(([domain, items], index) => `<li><span style="background:${palette[index % palette.length]}"></span><strong>${items.length}</strong>${escapeHtml(domain)}</li>`).join('');

    const peopleContainer = document.getElementById('people-bars');
    peopleContainer.innerHTML = `<div class="dashboard-route"><strong>${tasks.length} задач у повному списку</strong><span>Розробники, замовники, два дедлайни та статуси відкриваються у деталях.</span><button type="button" class="dashboard-route__button" data-dashboard-route="tasks">Відкрити задачі</button></div><div class="dashboard-route"><strong>${stats.developers.length} розробники апдейту</strong><span>${escapeHtml(stats.developers.join(' · ') || 'Не вказані')}</span><button type="button" class="dashboard-route__button" data-dashboard-route="kanban">Відкрити Kanban</button></div>`;
    peopleContainer.querySelectorAll('[data-dashboard-route]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.dashboardRoute === 'kanban') {
        document.querySelector('[data-view-target="kanban"]')?.click();
      } else {
        document.querySelector('[aria-labelledby="tasks-title"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }));

    const risks = [...stats.overdue, ...stats.warning];
    document.getElementById('risk-list').innerHTML = risks.length ? risks.map((task) => {
      const state = taskDeadlineState(task);
      return `<details class="update-risk-item update-risk-item--${state.key}"><summary><span class="update-risk-item__dot" aria-hidden="true"></span><strong>${escapeHtml(task.title)}</strong><em>${escapeHtml(state.label)}</em></summary><div class="update-risk-item__detail"><span>${escapeHtml(task.domain)}</span><p>${escapeHtml(task.status)}</p></div></details>`;
    }).join('') : '<p class="empty">Протермінованих або критичних дедлайнів немає.</p>';
    document.querySelectorAll('[data-tab]').forEach((button) => { button.textContent = { done: 'Всі задачі', active: 'В роботі', review: 'Дедлайни та питання' }[button.dataset.tab] || button.textContent; });
    const list = document.getElementById('task-list');
    const renderTab = (tab = 'done') => {
      const data = tab === 'review' ? risks : tab === 'active' ? tasks : tasks;
      list.innerHTML = data.length ? data.map(updateTaskLine).join('') : '<p class="empty">Немає задач для цього фільтра.</p>';
    };
    renderTab('done');
    document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => renderTab(button.dataset.tab)));
  }

  function renderUpdateModules(report) {
    const tasks = report.updateTasks || [];
    const container = document.getElementById('modules-map');
    document.querySelector('[aria-labelledby="modules-view-title"] .eyebrow')?.replaceChildren(document.createTextNode('Оновлення'));
    document.getElementById('modules-view-title')?.replaceChildren(document.createTextNode('Блоки апдейту'));
    const groups = [...new Map(tasks.map((task) => [task.domain, tasks.filter((item) => item.domain === task.domain)])).entries()];
    container.innerHTML = groups.map(([domain, items]) => {
      const overdue = items.filter((task) => taskDeadlineState(task).key === 'overdue').length;
      const warning = items.filter((task) => taskDeadlineState(task).key === 'warning').length;
      return `<article class="module-card"><div class="module-card__top"><strong>${escapeHtml(domain)}</strong></div><div class="module-card__numbers"><span><b>${items.length}</b> задач</span><span><b>${items.length - overdue}</b> в роботі</span></div><div class="module-card__meter"><span style="width:${Math.max(8, ((items.length - overdue) / items.length) * 100)}%"></span></div><p><i class="update-dot update-dot--healthy"></i>${items.length - overdue - warning} в роботі <i class="update-dot update-dot--warning"></i>${warning} завтра <i class="update-dot update-dot--overdue"></i>${overdue} протерміновано</p></article>`;
    }).join('');
  }

  function renderUpdateKanban(report) {
    const tasks = report.updateTasks || [];
    const columns = [
      { key: 'active', label: 'В роботі', items: tasks.filter((task) => ['healthy', 'muted'].includes(taskDeadlineState(task).key)) },
      { key: 'warning', label: 'Дедлайн завтра', items: tasks.filter((task) => taskDeadlineState(task).key === 'warning') },
      { key: 'overdue', label: 'Протерміновано', items: tasks.filter((task) => taskDeadlineState(task).key === 'overdue') }
    ];
    document.querySelector('[aria-labelledby="kanban-view-title"] .eyebrow')?.replaceChildren(document.createTextNode('Оновлення'));
    document.getElementById('kanban-view-title')?.replaceChildren(document.createTextNode('Kanban апдейту'));
    document.getElementById('kanban-board').innerHTML = columns.map((column) => `<section class="kanban-column kanban-column--${column.key}"><header><span>${column.label}</span><strong>${column.items.length}</strong></header><div class="update-mode-list">${column.items.map(updateTaskLine).join('') || '<p class="empty">Немає задач.</p>'}</div></section>`).join('');
  }

  function renderUpdateExecutive(report) {
    const tasks = report.updateTasks || [];
    const stats = updateModeStats(tasks);
    const domains = [...new Set(tasks.map((task) => task.domain))];
    document.querySelector('[aria-labelledby="executive-view-title"] .eyebrow')?.replaceChildren(document.createTextNode('Оновлення'));
    document.getElementById('executive-view-title')?.replaceChildren(document.createTextNode('Підсумок апдейту'));
    document.getElementById('executive-summary').innerHTML = `<section class="executive-hero"><p>Усі ${tasks.length} задач апдейту вважаються в роботі.</p><div><strong>${tasks.length}</strong><span>задач</span><strong>${stats.developers.length}</strong><span>розробники</span><strong>${stats.overdue.length}</strong><span>протерміновано</span></div></section><section class="executive-grid"><article><h3>Блоки апдейту</h3><ol>${domains.map((domain) => `<li><span>${escapeHtml(domain)}</span><strong>${tasks.filter((task) => task.domain === domain).length}</strong></li>`).join('')}</ol></article><article><h3>Фокус</h3><ul><li>${stats.noFeedback} задач без фідбеку</li><li>${stats.warning.length} задач із дедлайном завтра</li><li>${stats.questions} відкритих питань до замовників</li></ul></article></section>`;
  }

  function renderUpdateMatrix(report) {
    const tasks = report.updateTasks || [];
    const body = document.getElementById('service-matrix-body');
    const showDeveloper = tasks.some((task) => task.developer !== 'не вказано');
    const table = document.querySelector('.service-matrix');
    table?.classList.add('update-matrix');
    document.querySelector('[aria-labelledby="service-matrix-title"] .eyebrow')?.replaceChildren(document.createTextNode('Оновлення'));
    document.getElementById('service-matrix-title')?.replaceChildren(document.createTextNode('Матриця задач апдейту'));
    if (table) table.querySelector('thead').innerHTML = `<tr><th>Задача</th><th>Блок</th>${showDeveloper ? '<th>Розробники</th>' : ''}<th>Дедлайн розробників</th><th>Замовники</th><th>Дедлайн замовників</th><th>Стан</th></tr>`;
    body.innerHTML = tasks.map((task) => { const state = taskDeadlineState(task); return `<tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.domain)}</td>${showDeveloper ? `<td>${escapeHtml(task.developer)}</td>` : ''}<td>${escapeHtml(task.developerDeadline)}</td><td>${escapeHtml(task.client)}</td><td>${escapeHtml(task.clientDeadline)}</td><td><span class="status-pill status-pill--${state.key}">${state.label}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Немає задач.</td></tr>';
  }

  function renderUpdateFlows(report) {
    const tasks = report.updateTasks || [];
    const container = document.getElementById('data-flows-list');
    document.querySelector('[aria-labelledby="data-flows-title"] .eyebrow')?.replaceChildren(document.createTextNode('Оновлення'));
    document.getElementById('data-flows-title')?.replaceChildren(document.createTextNode('Блоки апдейту'));
    const groups = [...new Map(tasks.map((task) => [task.domain, tasks.filter((item) => item.domain === task.domain)])).entries()];
    container.innerHTML = groups.map(([domain, items]) => `<article class="flow-card"><header><span>${escapeHtml(domain)}</span><strong>${items.length} задач</strong></header><div class="flow-steps">${items.slice(0, 5).map((task, index) => `<button type="button" class="flow-step" data-update-flow-task="${escapeHtml(task.title)}"><i>${index + 1}</i><span>${escapeHtml(task.title)}</span></button>`).join('<b class="flow-arrow">→</b>')}</div></article>`).join('');
    const detail = document.getElementById('flow-detail');
    if (detail) detail.innerHTML = '<p class="empty">Вибери блок, щоб переглянути задачі апдейту.</p>';
    container.querySelectorAll('[data-update-flow-task]').forEach((button) => button.addEventListener('click', () => {
      const task = tasks.find((item) => item.title === button.dataset.updateFlowTask);
      if (!task || !detail) return;
      const state = taskDeadlineState(task);
      detail.innerHTML = `<div class="detail-kicker">${escapeHtml(task.domain)}</div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(state.label)} · ${escapeHtml(task.status)}</p><div class="detail-stats"><span><b>${escapeHtml(task.developer)}</b> розробники</span><span><b>${escapeHtml(task.client)}</b> замовники</span><span><b>${escapeHtml(task.developerDeadline)}</b> дедлайн розробників</span><span><b>${escapeHtml(task.clientDeadline)}</b> дедлайн замовників</span></div>`;
    }));
  }

  function renderUpdateMode(report) {
    renderUpdateDashboard(report);
    renderUpdateModules(report);
    renderUpdateKanban(report);
    renderUpdateExecutive(report);
    renderUpdateMatrix(report);
    renderUpdateFlows(report);
  }

  function renderUpdateTasks(report) {
    const container = document.getElementById('system-map');
    if (!container) return;
    const eyebrow = document.getElementById('update-task-eyebrow');
    if (eyebrow) eyebrow.textContent = report.updateTitle || 'Оновлення';
    const tasks = report.updateTasks || [];
    if (!tasks.length) {
      container.innerHTML = '<p class="empty">У звіті немає структурованого апдейту.</p>';
      return;
    }
    const groups = [...new Map(tasks.map((task) => [task.domain || 'Без блоку', null])).keys()]
      .map((domain) => ({ domain, tasks: tasks.filter((task) => (task.domain || 'Без блоку') === domain) }));
    const showDeveloper = tasks.some((task) => task.developer && task.developer !== 'не вказано');
    const taskRow = (task) => `<article class="update-task-row" role="row">
      <strong data-label="Задача">${escapeHtml(task.title)}</strong>
      <span data-label="Напрям">${escapeHtml(task.domain || 'не вказано')}</span>
      ${showDeveloper ? `<span data-label="Розробники">${escapeHtml(task.developer)}</span>` : ''}
      <time data-label="Дедлайн розробників">${escapeHtml(task.developerDeadline)}</time>
      <span data-label="Замовники">${escapeHtml(task.client)}</span>
      <time data-label="Дедлайн замовників">${escapeHtml(task.clientDeadline)}</time>
      <span data-label="Статус" class="update-task-status update-task-status--${updateTaskStatusClass(task.status)}">${escapeHtml(task.status)}</span>
    </article>`;
    container.innerHTML = groups.map((group, index) => {
      const developerSignal = deadlineSignal(group.tasks, 'developerDeadline');
      const clientSignal = deadlineSignal(group.tasks, 'clientDeadline');
      return `<section class="map-level update-task-level" data-update-domain="${escapeHtml(group.domain)}">
      <button class="map-level__toggle" type="button" data-update-toggle="${index}" aria-expanded="false">
        <span class="map-level__chevron" aria-hidden="true">›</span><span class="map-level__index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(group.domain)}</h3><strong>${group.tasks.length}</strong>
        <span class="update-deadline-signals" aria-label="Стани дедлайнів"><i class="update-deadline-signal update-deadline-signal--${developerSignal.key}" title="Апдейт розробника: ${escapeHtml(developerSignal.label)}"><b>Р</b></i><i class="update-deadline-signal update-deadline-signal--${clientSignal.key}" title="Апдейт замовника: ${escapeHtml(clientSignal.label)}"><b>З</b></i></span>
      </button>
      <div class="map-level__body update-task-level__body" hidden>
        <div class="update-task-table update-task-table--map${showDeveloper ? ' update-task-table--with-developer' : ''}" role="table" aria-label="${escapeHtml(group.domain)}">
          <div class="update-task-table__head" role="row"><span>Задача</span><span>Напрям</span>${showDeveloper ? '<span>Розробники</span>' : ''}<span>Дедлайн розробників</span><span>Замовники</span><span>Дедлайн замовників</span><span>Статус</span></div>
          ${group.tasks.map(taskRow).join('')}
        </div>
      </div>
    </section>`;
    }).join('');
    container.querySelectorAll('[data-update-toggle]').forEach((button) => button.addEventListener('click', () => {
      const level = button.closest('.update-task-level');
      const body = level.querySelector('.map-level__body');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      level.classList.toggle('is-expanded', !expanded);
      body.hidden = expanded;
      button.querySelector('.map-level__chevron').textContent = expanded ? '›' : '⌄';
    }));
  }

  function renderClassicProfile(report) {
    const root = document.querySelector('[data-profile-panel="classic"]');
    if (!root) return;
    const tasks = report.updateTasks || [];
    const updateOnly = Boolean(tasks.length && !report.kpis.worksectionClosed && !report.kpis.githubClosedPr && !report.kpis.activeProductTasks);
    const classicLabels = root.querySelectorAll('.classic-kpi > span');
    const classicValues = updateOnly ? { worksection: tasks.length, github: new Set(tasks.flatMap((task) => task.developer.split(',').map((value) => value.trim()).filter((value) => value.startsWith('@')))).size, active: tasks.length, review: tasks.filter((task) => task.status.includes('фідбек')).length } : { worksection: report.kpis.worksectionClosed, github: report.kpis.githubClosedPr, active: report.kpis.activeProductTasks, review: report.kpis.openReviewPr };
    if (updateOnly) {
      classicLabels[0].textContent = 'Задач в апдейті';
      classicLabels[1].textContent = 'Виконавці';
      classicLabels[2].textContent = 'Задач в роботі';
      classicLabels[3].textContent = 'Без фідбеку';
    }
    setText('classic-worksection', classicValues.worksection);
    setText('classic-worksection-note', updateOnly ? `${new Set(tasks.map((task) => task.domain)).size} функціональних блоків` : `${report.kpis.worksectionMeaningful} змістовних · ${report.kpis.worksectionService} службових`);
    setText('classic-github', classicValues.github);
    setText('classic-github-note', updateOnly ? 'вказані у поточному апдейті' : `${report.kpis.githubDenysPr} Denys-devit · ${report.kpis.githubKiraPr} batalova-kira`);
    setText('classic-active', classicValues.active);
    setText('classic-review', classicValues.review);
    const maxStage = Math.max(...(report.stages || []).map((stage) => stage.value), 1);
    document.getElementById('classic-stages').innerHTML = (report.stages || []).map((stage) => `<div class="classic-stage"><div><strong>${escapeHtml(stage.label)}</strong><span>${escapeHtml(stage.valueText)}</span></div><i><b style="width:${Math.round((stage.value / maxStage) * 100)}%"></b></i></div>`).join('') || '<p class="empty">Немає даних про стадії.</p>';
    const groups = [...new Map(tasks.map((task) => [task.domain || 'Без блоку', tasks.filter((item) => (item.domain || 'Без блоку') === (task.domain || 'Без блоку'))])).values()];
    document.getElementById('classic-blocks').innerHTML = groups.map((items) => `<div class="classic-block"><span>${escapeHtml(items[0].domain || 'Без блоку')}</span><strong>${items.length}</strong></div>`).join('') || '<p class="empty">Немає задач.</p>';
    const people = [...new Set(tasks.flatMap((task) => task.developer.split(',').map((value) => value.trim())).filter((value) => value && value !== 'не вказано'))];
    document.getElementById('classic-people').innerHTML = people.map((person) => `<div class="classic-person"><span>${escapeHtml(person)}</span><strong>${tasks.filter((task) => task.developer.split(',').map((value) => value.trim()).includes(person)).length}</strong></div>`).join('') || '<p class="empty">Виконавців не вказано.</p>';
    const risks = [...new Set([...(report.risks || []), ...tasks.filter((task) => /помил|баг|зауваж|не встиг|питання/i.test(`${task.title} ${task.status}`)).map((task) => task.title)])];
    document.getElementById('classic-risks').innerHTML = risks.map((risk) => `<p>${escapeHtml(risk)}</p>`).join('') || '<p class="empty">Критичних ризиків не зафіксовано.</p>';
  }

  const CLIENT_TWO_BASE_STRUCTURE = [
    { name: 'Канали та інтерфейси', tone: 'cyan', services: ['Основний кабінет · frontend-nextjs', 'Адмінпанель · admin', 'Публічний сайт · lending + lending-api', 'Realtime / AI-чат · websocket-server'] },
    { name: 'Ядро керування', tone: 'blue', services: ['Ідентифікація · auth', 'Організації · office-user', 'AI-оркестрація · main-orchestrator', 'Внутрішній шлюз · gateway + service API'] },
    { name: 'Бізнес-домени й сервіси', tone: 'violet', services: ['Документи й кадри · agreements, document-flow, documents-reports, staff_doc', 'Облік і податки · income_accounting_book_report, calculation_ep, dps, tax_reporting_service, findesk-calendar', 'AI і комунікації · ai_chat, main-orchestrator, notifications, statistics_email', 'Комерція й контури · credit_system, way4pay, tov-core, deploy/tov-initask'] },
    { name: 'Дані, події та спільна платформа', tone: 'amber', services: ['PostgreSQL', 'Redis', 'Kafka', 'TaskIQ', 'Файли', 'shared/'] },
    { name: 'Зовнішні інтеграції', tone: 'green', services: ['Ідентифікація · Google Auth, Дія / Дія.Підпис', 'Держава / ЄДО · ДПС, Вчасно, МЕДОК', 'Фінанси · банки, ПРРО, WayForPay, LiqPay', 'Штучний інтелект · OpenAI, Google Gemini', 'Комунікації · Telegram, Email, SMS, Taxer.ua'] },
    { name: 'Доставка, якість та управління', tone: 'red', services: ['Код і CI · Findesk-prod, GitHub Actions', 'Розгортання · Docker / Dokploy', 'Спостереження · GlitchTip + logs', 'Керування роботою · Worksection 311247'] }
  ];

  function mergeClientTwoReportStructure(savedStructure, reportStructure) {
    if (!reportStructure?.length) return savedStructure;
    const structure = reportStructure.map((block) => ({ ...block, services: (block.services || []).map((service) => typeof service === 'string' ? service : ({ ...service, children: [...(service.children || [])], tasks: [...(service.tasks || [])] })) }));
    const reportBlockNames = new Set(structure.map((block) => block.name));
    savedStructure.filter((savedBlock) => savedBlock.source === 'manual').forEach((savedBlock) => {
      if (!reportBlockNames.has(savedBlock.name)) structure.push({ ...savedBlock, services: [...(savedBlock.services || [])] });
      else {
        const target = structure.find((item) => item.name === savedBlock.name);
        const manualServices = (savedBlock.services || []).filter((item) => typeof item === 'object' && item.source === 'manual');
        target.services.push(...manualServices);
      }
    });
    return structure;
  }

  function readClientTwoStructure() {
    try {
      const stored = JSON.parse(window.localStorage.getItem('findesk-client-two-structure') || 'null');
      if (Array.isArray(stored) && stored.length) return stored;
    } catch (error) {
      console.warn('Client 2 structure preference is unavailable.', error);
    }
    return CLIENT_TWO_BASE_STRUCTURE.map((block) => ({ ...block, services: [...block.services] }));
  }

  function saveClientTwoStructure(structure) {
    try { window.localStorage.setItem('findesk-client-two-structure', JSON.stringify(structure)); } catch (error) { /* local preference is optional */ }
  }

  function renderClientTwoStructure(structure, syncMessage = 'Базову структуру завантажено.') {
    const container = document.getElementById('client-two-structure');
    const parent = document.getElementById('client-two-structure-parent');
    if (!container || !parent) return;
    parent.innerHTML = '<option value="">Новий основний блок</option>' + structure.map((block, index) => `<option value="${index}">${escapeHtml(block.name)}</option>`).join('');
    const reportTasks = window.clientTwoReportTasks || [];
    container.innerHTML = structure.map((block, blockIndex) => `<details class="client-structure-block client-structure-block--${escapeHtml(block.tone || 'cyan')}"><summary><div><span class="client-structure-index">${String(blockIndex + 1).padStart(2, '0')}</span><h3>${escapeHtml(block.name)}</h3></div><span class="client-structure-summary-count">${(block.services || []).length} сервісів</span></summary><div class="client-structure-body"><button class="icon-button client-structure-remove client-structure-block-remove" type="button" data-remove-block="${blockIndex}" title="Видалити блок" aria-label="Видалити блок">×</button><ul>${(block.services || []).map((service, serviceIndex) => { const item = typeof service === 'string' ? { name: service, children: [] } : service; const serviceTasks = reportTasks.filter((task) => task.block === block.name && (task.service === item.name || task.service?.startsWith(`${item.name} (`))); const taskMarkup = serviceTasks.length ? `<details class="client-service-tasks"><summary>${serviceTasks.length} задач</summary><div>${serviceTasks.map((task) => `<p class="client-task-hover" tabindex="0"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.status)} · ${escapeHtml(task.developer)}</small><span class="client-task-hover__popover" role="tooltip"><b>${escapeHtml(task.title)}</b><span>Блок: ${escapeHtml(task.block)}</span><span>Сервіс: ${escapeHtml(task.service)}</span><span>Статус: ${escapeHtml(task.status)}</span><span>Виконавець: ${escapeHtml(task.developer)}</span><span>Дедлайн: ${escapeHtml(task.deadline)}</span><span>Джерело: ${escapeHtml(task.source)}</span></span></p>`).join('')}</div></details>` : ''; return `<li><span><strong>${escapeHtml(item.name)}</strong>${item.children?.length ? `<small class="client-structure-children">${escapeHtml(item.children.join(', '))}</small>` : ''}${taskMarkup}</span><button class="icon-button client-structure-remove" type="button" data-remove-service="${blockIndex}:${serviceIndex}" title="Видалити сервіс" aria-label="Видалити сервіс">×</button></li>`; }).join('') || '<li class="empty">Сервіси ще не додані.</li>'}</ul></div></details>`).join('');
    container.querySelectorAll('[data-remove-block]').forEach((button) => button.addEventListener('click', () => {
      structure.splice(Number(button.dataset.removeBlock), 1);
      saveClientTwoStructure(structure);
      renderClientTwoStructure(structure, 'Блок видалено.');
    }));
    container.querySelectorAll('[data-remove-service]').forEach((button) => button.addEventListener('click', () => {
      const [blockIndex, serviceIndex] = button.dataset.removeService.split(':').map(Number);
      structure[blockIndex].services.splice(serviceIndex, 1);
      saveClientTwoStructure(structure);
      renderClientTwoStructure(structure, 'Сервіс видалено.');
    }));
    setText('client-two-structure-status', syncMessage);
  }

  function syncClientTwoStructureFromReport(structure, report) {
    const reportServices = [...new Set((report?.updateTasks || []).map((task) => task.service).filter(Boolean))];
    const knownServices = new Set(structure.flatMap((block) => (block.services || []).map((service) => typeof service === 'string' ? service : service.name)));
    const newServices = reportServices.filter((service) => !knownServices.has(service));
    if (!newServices.length) return { structure, message: 'Структура завантажена. Нових сервісів у звіті не знайдено.' };
    let reportBlock = structure.find((block) => block.name === 'Сервіси зі звіту');
    if (!reportBlock) {
      reportBlock = { name: 'Сервіси зі звіту', tone: 'amber', services: [] };
      structure.push(reportBlock);
    }
    reportBlock.services.push(...newServices);
    saveClientTwoStructure(structure);
    return { structure, message: `Структура оновлена зі звіту: додано ${newServices.length} сервісів.` };
  }

  function renderClientTwoProfile(report, clientReport = report) {
    const root = document.querySelector('[data-profile-panel="client-two"]');
    if (!root) return;
    window.clientTwoReportTasks = clientReport.tasks || [];
    let structure = mergeClientTwoReportStructure(readClientTwoStructure(), clientReport.blocks);
    const synced = clientReport.blocks?.length ? { structure, message: `Структура завантажена зі звіту: ${clientReport.tasks.length} задач.` } : syncClientTwoStructureFromReport(structure, clientReport);
    structure = synced.structure;
    renderClientTwoStructure(structure, synced.message);
    const renderTasks = (targetId, filter) => {
      const target = document.getElementById(targetId);
      if (!target) return;
      const filtered = (clientReport.tasks || []).filter((task) => !filter || filter(task));
      target.innerHTML = filtered.map((task) => `<article class="client-task client-task-hover" tabindex="0"><div class="client-task__title"><strong>${escapeHtml(task.title)}</strong><span class="client-type">${escapeHtml(task.status)}</span></div><div class="client-task__facts"><span><b>Блок / сервіс</b>${escapeHtml(task.block)} · ${escapeHtml(task.service)}</span><span><b>Виконавець</b>${escapeHtml(task.developer)}</span><span><b>Дедлайн</b>${escapeHtml(task.deadline)}</span><span><b>Джерело</b>${escapeHtml(task.source)}</span></div><span class="client-task-hover__popover" role="tooltip"><b>${escapeHtml(task.title)}</b><span>Блок: ${escapeHtml(task.block)}</span><span>Сервіс: ${escapeHtml(task.service)}</span><span>Статус: ${escapeHtml(task.status)}</span><span>Виконавець: ${escapeHtml(task.developer)}</span><span>Дедлайн: ${escapeHtml(task.deadline)}</span><span>Джерело: ${escapeHtml(task.source)}</span></span></article>`).join('') || '<p class="empty client-info-empty">За цим ракурсом задач не знайдено.</p>';
    };
    renderTasks('client-two-tasks-all');
    renderTasks('client-two-tasks-active', (task) => /активна|у роботі|перевірці/i.test(task.status));
    renderTasks('client-two-tasks-deadlines', (task) => task.deadline !== 'інформація відсутня' || /питан|дедлайн|фідбек/i.test(`${task.title} ${task.status}`));
    if (!root.dataset.viewsBound) {
      root.querySelectorAll('[data-client-two-view]').forEach((button) => button.addEventListener('click', () => {
        const view = button.dataset.clientTwoView;
        root.querySelectorAll('[data-client-two-view]').forEach((item) => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active)); });
        root.querySelectorAll('[data-client-two-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.clientTwoViewPanel !== view; });
      }));
      root.dataset.viewsBound = 'true';
    }
    const form = document.getElementById('client-two-structure-form');
    if (form && !form.dataset.bound) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const nameInput = document.getElementById('client-two-structure-name');
        const parentInput = document.getElementById('client-two-structure-parent');
        const name = nameInput.value.trim();
        const parentIndex = parentInput.value;
        if (!name) return;
        if (parentIndex === '') structure.push({ name, tone: 'cyan', services: [], source: 'manual' });
        else structure[Number(parentIndex)].services.push({ name, children: [], source: 'manual' });
        saveClientTwoStructure(structure);
        nameInput.value = '';
        renderClientTwoStructure(structure, parentIndex === '' ? 'Основний блок додано.' : 'Сервіс додано.');
      });
      document.getElementById('client-two-structure-reset')?.addEventListener('click', () => {
        structure = CLIENT_TWO_BASE_STRUCTURE.map((block) => ({ ...block, services: [...block.services] }));
        saveClientTwoStructure(structure);
        renderClientTwoStructure(structure, 'Базову структуру відновлено.');
      });
      form.dataset.bound = 'true';
    }
  }

  function activateProfile(profileName) {
    const profile = ['client-two', 'classic'].includes(profileName) ? profileName : 'operational';
    document.querySelectorAll('.profile-button').forEach((button) => {
      const active = button.dataset.profileTarget === profile;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.view-panel').forEach((panel) => { panel.hidden = profile !== 'operational'; });
    document.querySelectorAll('[data-profile-panel]').forEach((panel) => { panel.hidden = panel.dataset.profilePanel !== profile; });
    const sourceStatus = window.profileSourceStatus?.[profile];
    if (sourceStatus) setText('source-status', sourceStatus);
    try { window.localStorage.setItem('findesk-profile', profile); } catch (error) { /* preference is optional */ }
  }

  function renderArchitecture(model) {
    window.currentArchitecture = model;
    window.architectureFilter = 'all';
    window.architectureQuery = '';
    window.architectureRelatedOnly = false;
    window.systemMapExpanded = new Set();
    window.architectureSelection = model.byKey.has('main-orchestrator') ? 'main-orchestrator' : model.services[0]?.key;
    const metrics = buildSystemMapViewModel(model).metrics;
    document.getElementById('system-map-services').textContent = metrics.services;
    document.getElementById('system-map-levels').textContent = metrics.levels;
    document.getElementById('system-map-flows').textContent = metrics.flows;
    document.getElementById('system-map-attention').textContent = metrics.attention;
    renderSystemMap(model);
    closeServiceDetail();
    renderServiceMatrix(model);
    renderDataFlows(model);
    document.querySelectorAll('[data-structure-filter]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-structure-filter]').forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      window.architectureFilter = button.dataset.structureFilter;
      renderSystemMap(model, window.architectureFilter, window.architectureQuery, window.architectureRelatedOnly);
    }));
    document.getElementById('structure-search')?.addEventListener('input', (event) => {
      window.architectureQuery = event.target.value;
      renderSystemMap(model, window.architectureFilter, window.architectureQuery, window.architectureRelatedOnly);
    });
    document.getElementById('structure-related-only')?.addEventListener('change', (event) => {
      window.architectureRelatedOnly = event.target.checked;
      renderSystemMap(model, window.architectureFilter, window.architectureQuery, window.architectureRelatedOnly);
    });
    window.setTimeout(closeServiceDetail, 2000);
    document.querySelectorAll('[data-matrix-mode]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-matrix-mode]').forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      renderServiceMatrix(model, button.dataset.matrixMode, window.matrixSort);
    }));
    document.querySelector('[data-matrix-sort]')?.addEventListener('click', (event) => {
      window.matrixSort = !window.matrixSort;
      event.currentTarget.classList.toggle('is-active', window.matrixSort);
      renderServiceMatrix(model, document.querySelector('[data-matrix-mode].is-active')?.dataset.matrixMode || 'all', window.matrixSort);
    });
    document.getElementById('service-detail-overlay')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-detail-close]')) closeServiceDetail();
    });
  }

  function renderViews(report) {
    const viewModels = buildViewModels(report);
    window.currentViewModels = viewModels;
    renderModulesMap(viewModels);
    renderKanban(viewModels);
    renderExecutive(viewModels, report);
  }

  function activateView(viewName) {
    document.querySelectorAll('.view-button').forEach((button) => {
      const active = button.dataset.viewTarget === viewName;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.view-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.view === viewName);
    });
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme) || 'light';
    document.documentElement.dataset.theme = normalized;
    document.querySelectorAll('.theme-button').forEach((button) => {
      const active = button.dataset.themeValue === normalized;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setTheme(theme) {
    const normalized = normalizeTheme(theme) || 'light';
    applyTheme(normalized);
    try {
      window.localStorage.setItem('findesk-theme', normalized);
    } catch (error) {
      console.warn('Theme preference was not saved.', error);
    }
  }

  function renderReport(report, structurePayload) {
    const insights = buildInsightCards(report);
    window.currentInsights = insights;
    document.body.classList.add('is-loaded');
    const updateOnly = Boolean(report.updateTasks?.length && !report.kpis.worksectionClosed && !report.kpis.githubClosedPr && !report.kpis.activeProductTasks);
    document.body.classList.toggle('is-update-only', updateOnly);
    setText('page-title', report.title);
    setText('report-subtitle', report.reportDate ? `Звіт за ${report.reportDate}; станом на ${report.statusDate}` : report.updateTitle || 'Щоденний апдейт');
    setText('source-status', 'reports/current.md підключено');
    setText('updated-at', `Оновлено: ${formatDateTime(new Date())}`);
    setText('kpi-worksection', report.kpis.worksectionClosed);
    setText('kpi-worksection-note', `${report.kpis.worksectionMeaningful} змістовних · ${report.kpis.worksectionService} службових`);
    setText('kpi-github', report.kpis.githubClosedPr);
    setText('kpi-github-note', `${report.kpis.githubDenysPr} Denys-devit · ${report.kpis.githubKiraPr} batalova-kira`);
    setText('kpi-active', report.kpis.activeProductTasks);
    setText('kpi-review', report.kpis.openReviewPr);
    if (updateOnly) {
      const updateTasks = report.updateTasks;
      const noFeedback = updateTasks.filter((task) => task.status.includes('фідбек')).length;
      const openQuestions = updateTasks.filter((task) => task.status.includes('питання')).length;
      const blockCount = new Set(updateTasks.map((task) => task.domain).filter(Boolean)).size;
      const developers = [...new Set(updateTasks.flatMap((task) => task.developer.split(',').map((value) => value.trim()).filter((value) => value.startsWith('@'))))];
      const developerDeadlines = updateTasks.filter((task) => task.developerDeadline !== 'не вказано').length;
      const clientDeadlines = updateTasks.filter((task) => task.clientDeadline !== 'не вказано').length;
      document.querySelector('.metric--worksection > span').textContent = 'Задач в апдейті';
      document.querySelector('.metric--worksection > small').textContent = `${blockCount} блоків`;
      document.querySelector('.metric--github > span').textContent = 'Розробники';
      document.querySelector('.metric--github > small').textContent = developers.join(' · ') || 'не вказані';
      document.querySelector('.metric--active > span').textContent = 'Без фідбеку';
      document.querySelector('.metric--active > small').textContent = `${openQuestions} відкритих питань`;
      document.querySelector('.metric--review > span').textContent = 'Дедлайни';
      document.querySelector('.metric--review > small').textContent = `${developerDeadlines} розробника · ${clientDeadlines} замовника`;
      setText('kpi-worksection', updateTasks.length);
      setText('kpi-worksection-note', `${blockCount} блоків`);
      setText('kpi-github', developers.length);
      setText('kpi-github-note', developers.join(' · ') || 'не вказані');
      setText('kpi-active', noFeedback);
      setText('kpi-review', developerDeadlines + clientDeadlines);
    } else {
      document.querySelector('.metric--worksection')?.insertAdjacentHTML('beforeend', insightButton(insights.kpis.worksection.title, insights.kpis.worksection.body));
      document.querySelector('.metric--github')?.insertAdjacentHTML('beforeend', insightButton(insights.kpis.github.title, insights.kpis.github.body));
      document.querySelector('.metric--active')?.insertAdjacentHTML('beforeend', insightButton(insights.kpis.active.title, insights.kpis.active.body));
      document.querySelector('.metric--review')?.insertAdjacentHTML('beforeend', insightButton(insights.kpis.review.title, insights.kpis.review.body));
    }

    renderDonut(report);
    renderPeople(report);
    renderRisks(report);
    renderTasks(report);
    renderViews(report);
    if (structurePayload?.markdown) {
      const structure = parseProjectStructure(structurePayload.markdown);
      renderArchitecture(buildArchitectureViewModels(structure, report));
      const warning = document.getElementById('structure-warning');
      if (warning && structurePayload.stale) {
        warning.hidden = false;
        warning.textContent = 'Файл структури недоступний. Показано останню локальну копію.';
      }
    }
    renderUpdateTasks(report);
    if (updateOnly) renderUpdateMode(report);
    attachPopovers();
  }

  function showError(error) {
    setText('source-status', 'Не вдалося прочитати reports/current.md');
    setText('report-subtitle', 'Перевір, що файл лежить у D:\\deyliky\\reports\\current.md і сторінку відкрито через start-local.cmd');
    console.error(error);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildDeveloperMenus,
      buildArchitectureViewModels,
      buildInsightCards,
      buildSystemMapViewModel,
      shouldOpenServiceDetail,
      buildViewModels,
      mergeStructureWithReport,
      normalizeTheme,
      parseDailyReport,
      parseClientTwoReport,
      parseUpdateTasks,
      parseProjectStructure,
      resolveInitialTheme
    };
  }

  if (typeof window !== 'undefined') {
    window.parseDailyReport = parseDailyReport;
    document.addEventListener('DOMContentLoaded', async () => {
      let savedTheme = null;
      try {
        savedTheme = window.localStorage.getItem('findesk-theme');
      } catch (error) {
        savedTheme = null;
      }
      applyTheme(resolveInitialTheme(savedTheme, window.matchMedia?.('(prefers-color-scheme: dark)').matches));

      document.querySelectorAll('.tab').forEach((button) => {
        button.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach((item) => item.classList.remove('is-active'));
          button.classList.add('is-active');
          if (window.currentDailyReport) renderTasks(window.currentDailyReport, button.dataset.tab);
        });
      });
      document.querySelectorAll('.view-button').forEach((button) => {
        button.addEventListener('click', () => { activateProfile('operational'); activateView(button.dataset.viewTarget); });
      });
      document.querySelectorAll('.profile-button').forEach((button) => {
        button.addEventListener('click', () => activateProfile(button.dataset.profileTarget));
      });
      let initialProfile = new URLSearchParams(window.location.search).get('profile');
      if (!initialProfile) {
        try { initialProfile = window.localStorage.getItem('findesk-profile'); } catch (error) { initialProfile = null; }
      }
      activateProfile(initialProfile || 'operational');
      document.querySelectorAll('.theme-button').forEach((button) => {
        button.addEventListener('click', () => setTheme(button.dataset.themeValue));
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeServiceDetail();
      });

      try {
        const reportResponse = await fetch('reports/current.md', { cache: 'no-store' });
        if (!reportResponse.ok) throw new Error(`HTTP ${reportResponse.status}`);
        const markdown = await reportResponse.text();
        let clientTwoReport = null;
        let clientTwoSourceStatus = 'reports/current-2.md не знайдено';
        try {
          const clientTwoResponse = await fetch('reports/current-2.md', { cache: 'no-store' });
          if (clientTwoResponse.ok) {
            clientTwoReport = parseClientTwoReport(await clientTwoResponse.text());
            clientTwoSourceStatus = 'reports/current-2.md підключено';
          }
        } catch (clientTwoError) {
          console.warn('Client 2 profile source is unavailable.', clientTwoError);
        }
        let classicReport = null;
        let classicSourceStatus = 'reports/current-3.md не знайдено';
        try {
          const classicResponse = await fetch('reports/current-3.md', { cache: 'no-store' });
          if (classicResponse.ok) {
            classicReport = parseDailyReport(await classicResponse.text());
            classicSourceStatus = 'reports/current-3.md підключено';
          }
        } catch (classicError) {
          console.warn('Classic profile source is unavailable.', classicError);
        }
        let structurePayload = null;
        try {
          const structureResponse = await fetch('api/project-structure', { cache: 'no-store' });
          structurePayload = structureResponse.ok ? await structureResponse.json() : null;
        } catch {
          structurePayload = null;
        }
        if (!structurePayload?.markdown) {
          const fallbackResponse = await fetch('data/project-structure.md', { cache: 'no-store' });
          if (fallbackResponse.ok) {
            structurePayload = { source: 'static fallback', stale: true, markdown: await fallbackResponse.text() };
          }
        }
        const report = parseDailyReport(markdown);
        clientTwoReport ||= { blocks: [], tasks: [] };
        classicReport ||= report;
        window.profileSourceStatus = {
          operational: 'reports/current.md підключено',
          'client-two': clientTwoSourceStatus,
          classic: classicSourceStatus
        };
        window.profileReports = {
          operational: report,
          'client-two': clientTwoReport,
          classic: classicReport
        };
        window.currentDailyReport = report;
        renderReport(report, structurePayload);
        renderClassicProfile(classicReport);
        renderClientTwoProfile(report, clientTwoReport);
        activateProfile(initialProfile || 'operational');
      } catch (error) {
        showError(error);
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);


