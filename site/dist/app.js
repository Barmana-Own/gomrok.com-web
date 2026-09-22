(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var body = document.body;

  function closeMenus() {
    document.querySelectorAll("[data-menu-panel]").forEach(function (panel) {
      panel.hidden = true;
    });
    document.querySelectorAll("[data-menu-trigger]").forEach(function (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  document.querySelectorAll("[data-menu-trigger]").forEach(function (trigger) {
    trigger.addEventListener("click", function () {
      var name = trigger.getAttribute("data-menu-trigger");
      var panel = document.querySelector('[data-menu-panel="' + name + '"]');
      var willOpen = panel.hidden;
      closeMenus();
      if (willOpen) {
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".menu-wrap")) closeMenus();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenus();
  });

  var mobileButton = document.querySelector("[data-mobile-menu]");
  var mobilePanel = document.querySelector("[data-mobile-panel]");
  if (mobileButton && mobilePanel) {
    mobileButton.addEventListener("click", function () {
      var open = mobilePanel.hidden;
      mobilePanel.hidden = !open;
      mobileButton.setAttribute("aria-expanded", String(open));
      body.classList.toggle("menu-open", open);
    });
    mobilePanel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        mobilePanel.hidden = true;
        mobileButton.setAttribute("aria-expanded", "false");
        body.classList.remove("menu-open");
      });
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var selector = link.getAttribute("href");
      var target = document.querySelector(selector);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      closeMenus();
    });
  });

  var heroSection = document.querySelector("[data-hero-section]");
  var heroCanvas = document.querySelector("[data-hero-canvas]");
  var heroPoster = document.querySelector(".hero-frame-poster");
  var heroCopies = Array.prototype.slice.call(document.querySelectorAll("[data-hero-copy]"));
  var heroIndicator = document.querySelector(".hero-scroll-indicator");
  var heroContext = heroCanvas ? heroCanvas.getContext("2d") : null;
  var heroFrameCount = window.innerWidth <= 800 ? 409 : 410;
  var heroFrameIndex = -1;
  var heroFrameImages = new Map();
  var heroFrameRequests = new Map();
  var heroAnimationFrame = 0;
  var heroIsVisible = false;
  var heroLoadingStarted = false;
  var heroWorker = null;
  var heroWorkerUrl = "";
  var heroQueueCursor = 0;
  var heroLoadTimer = 0;
  var heroFrameFolder = window.innerWidth <= 800 ? "mobile" : "desktop";

  function heroFrameUrl(index) {
    return "https://terminal-industries.com/static/frames/home/" + heroFrameFolder + "/webp/hero_anim_" + heroFrameFolder + "_60_" + index + ".webp";
  }

  function heroWorkerSource() {
    return [
      "self.addEventListener('message', async function (event) {",
      "  if (!event.data || event.data.type !== 'frames') return;",
      "  var frames = event.data.payload.frames || [];",
      "  var blobs = await Promise.all(frames.map(async function (frame) {",
      "    try {",
      "      var response = await fetch(frame);",
      "      if (!response.ok) return null;",
      "      return { blob: await response.blob(), frame: frame };",
      "    } catch (error) {",
      "      return null;",
      "    }",
      "  }));",
      "  self.postMessage({ type: 'blobs', payload: { blobs: blobs.filter(Boolean) } });",
      "});"
    ].join("\n");
  }

  function destroyHeroWorker() {
    if (heroLoadTimer) window.clearTimeout(heroLoadTimer);
    heroLoadTimer = 0;
    if (heroWorker) heroWorker.terminate();
    heroWorker = null;
    if (heroWorkerUrl) window.URL.revokeObjectURL(heroWorkerUrl);
    heroWorkerUrl = "";
  }

  function createHeroWorker() {
    if (!window.Worker || !window.Blob || !window.URL || !window.URL.createObjectURL) return null;
    try {
      heroWorkerUrl = window.URL.createObjectURL(new Blob([heroWorkerSource()], { type: "application/javascript" }));
      heroWorker = new Worker(heroWorkerUrl, { name: "terminal-hero-sequence" });
      heroWorker.addEventListener("message", function (event) {
        var blobs = event.data && event.data.payload && event.data.payload.blobs;
        if (!Array.isArray(blobs)) return;
        blobs.forEach(function (record) {
          var frameIndex = heroFrameRequests.get(record.frame);
          if (frameIndex === undefined || heroFrameImages.has(frameIndex)) return;
          var objectUrl = window.URL.createObjectURL(record.blob);
          var image = new Image();
          image.decoding = "async";
          image.onload = function () {
            var entry = heroFrameImages.get(frameIndex);
            if (entry) entry.ready = true;
            if (frameIndex === heroFrameIndex) drawHeroFrame(image);
            else if (heroFrameIndex >= 0 && !getReadyHeroFrame(heroFrameIndex)) {
              var fallback = closestLoadedHeroFrame(heroFrameIndex);
              if (fallback) drawHeroFrame(fallback.image);
            }
          };
          image.onerror = function () {
            window.URL.revokeObjectURL(objectUrl);
            heroFrameImages.delete(frameIndex);
          };
          heroFrameImages.set(frameIndex, { image: image, objectUrl: objectUrl, ready: false, index: frameIndex });
          image.src = objectUrl;
        });
        requestHeroRender();
      });
      heroWorker.addEventListener("error", function () {
        destroyHeroWorker();
        heroFrameRequests.clear();
        startDirectHeroLoading();
      });
      return heroWorker;
    } catch (error) {
      destroyHeroWorker();
      return null;
    }
  }

  function loadHeroFrame(index, priority) {
    var safeIndex = Math.max(0, Math.min(heroFrameCount - 1, index));
    var existing = heroFrameImages.get(safeIndex);
    if (existing) return existing.image;
    var image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.fetchPriority = priority || (safeIndex === 0 ? "high" : "low");
    image.src = heroFrameUrl(safeIndex);
    image.addEventListener("load", function () {
      var entry = heroFrameImages.get(safeIndex);
      if (entry) entry.ready = true;
      if (safeIndex === heroFrameIndex) drawHeroFrame(image);
    });
    image.addEventListener("error", function () {
      var entry = heroFrameImages.get(safeIndex);
      if (entry && entry.image === image) heroFrameImages.delete(safeIndex);
    });
    heroFrameImages.set(safeIndex, { image: image, objectUrl: "", ready: false, index: safeIndex });
    return image;
  }

  function closestLoadedHeroFrame(index) {
    for (var distance = 1; distance < heroFrameCount; distance += 1) {
      var before = getReadyHeroFrame(index - distance);
      if (before) return before;
      var after = getReadyHeroFrame(index + distance);
      if (after) return after;
    }
    return null;
  }

  function getReadyHeroFrame(index) {
    if (index < 0 || index >= heroFrameCount) return null;
    var entry = heroFrameImages.get(index);
    return entry && entry.ready && entry.image.complete && entry.image.naturalWidth ? entry : null;
  }

  function requestHeroFrame(index) {
    var safeIndex = Math.max(0, Math.min(heroFrameCount - 1, index));
    var url = heroFrameUrl(safeIndex);
    var alreadyRequested = heroFrameRequests.has(url);
    if (!alreadyRequested) heroFrameRequests.set(url, safeIndex);
    if (heroWorker) {
      if (alreadyRequested && heroFrameImages.has(safeIndex)) return;
      if (heroFrameImages.has(safeIndex)) return;
      if (priority === "high") {
        loadHeroFrame(safeIndex, "high");
      } else if (!alreadyRequested) {
        heroWorker.postMessage({ type: "frames", payload: { frames: [url] } });
      }
      return;
    }
    loadHeroFrame(safeIndex, safeIndex === heroFrameIndex ? "high" : "low");
  }

  function requestHeroBatch(start, size) {
    var urls = [];
    for (var index = start; index < Math.min(heroFrameCount, start + size); index += 1) {
      var url = heroFrameUrl(index);
      if (!heroFrameRequests.has(url)) {
        heroFrameRequests.set(url, index);
        urls.push(url);
      }
    }
    if (!urls.length) return;
    if (heroWorker) {
      heroWorker.postMessage({ type: "frames", payload: { frames: urls } });
      return;
    }
    urls.forEach(function (url) {
      loadHeroFrame(heroFrameRequests.get(url), "low");
    });
  }

  function startDirectHeroLoading() {
    if (!heroLoadingStarted) heroLoadingStarted = true;
    for (var index = 0; index < Math.min(heroFrameCount, 18); index += 1) requestHeroFrame(index);
    heroQueueCursor = Math.min(heroFrameCount, 18);
    function loadNextBatch() {
      if (heroQueueCursor >= heroFrameCount) return;
      requestHeroBatch(heroQueueCursor, 6);
      heroQueueCursor += 6;
      heroLoadTimer = window.setTimeout(loadNextBatch, 45);
    }
    loadNextBatch();
  }

  function warmHeroFrames() {
    if (heroLoadingStarted) return;
    heroLoadingStarted = true;
    heroWorker = createHeroWorker();
    requestHeroBatch(0, Math.min(heroFrameCount, 18));
    heroQueueCursor = Math.min(heroFrameCount, 18);
    function loadNextBatch() {
      if (heroQueueCursor >= heroFrameCount) return;
      requestHeroBatch(heroQueueCursor, 12);
      heroQueueCursor += 12;
      heroLoadTimer = window.setTimeout(loadNextBatch, 35);
    }
    loadNextBatch();
  }

  function resizeHeroCanvas() {
    if (!heroCanvas) return;
    var nextFolder = window.innerWidth <= 800 ? "mobile" : "desktop";
    if (nextFolder !== heroFrameFolder) {
      destroyHeroWorker();
      heroFrameImages.forEach(function (entry) {
        if (entry.objectUrl) window.URL.revokeObjectURL(entry.objectUrl);
      });
      heroFrameFolder = nextFolder;
      heroFrameCount = nextFolder === "mobile" ? 409 : 410;
      heroFrameImages.clear();
      heroFrameRequests.clear();
      heroFrameIndex = -1;
      heroLoadingStarted = false;
      heroQueueCursor = 0;
    }
    var pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    var width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    var height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
    if (heroCanvas.width !== width || heroCanvas.height !== height) {
      heroCanvas.width = width;
      heroCanvas.height = height;
      heroCanvas.style.width = window.innerWidth + "px";
      heroCanvas.style.height = window.innerHeight + "px";
    }
    if (heroPoster && heroPoster.src !== heroFrameUrl(0)) heroPoster.src = heroFrameUrl(0);
    var current = getReadyHeroFrame(heroFrameIndex);
    if (current) drawHeroFrame(current.image);
  }

  function drawHeroFrame(image) {
    if (!heroCanvas || !heroContext || !image || !image.naturalWidth) return;
    var pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    var canvasWidth = heroCanvas.width / pixelRatio;
    var canvasHeight = heroCanvas.height / pixelRatio;
    var scale = Math.max(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight);
    var width = image.naturalWidth * scale;
    var height = image.naturalHeight * scale;
    heroContext.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
    heroContext.drawImage(image, (canvasWidth - width) * pixelRatio / 2, (canvasHeight - height) * pixelRatio / 2, width * pixelRatio, height * pixelRatio);
  }

  function setHeroCopy(index) {
    heroCopies.forEach(function (copy, copyIndex) {
      copy.classList.toggle("is-active", copyIndex === index);
    });
  }

  function updateHeroProgress(progress) {
    if (progress < 0.12) setHeroCopy(-1);
    else if (progress < 0.43) setHeroCopy(0);
    else if (progress < 0.7) setHeroCopy(1);
    else setHeroCopy(2);
    if (heroIndicator) heroIndicator.style.opacity = progress < 0.08 ? "1" : "0";
  }

  function renderHero() {
    if (!heroSection) return;
    var maxScroll = Math.max(1, heroSection.offsetHeight - window.innerHeight);
    var progress = Math.max(0, Math.min(1, -heroSection.getBoundingClientRect().top / maxScroll));
    var nextFrame = Math.round(progress * (heroFrameCount - 1));
    if (nextFrame !== heroFrameIndex) {
      var direction = nextFrame >= heroFrameIndex ? 1 : -1;
      heroFrameIndex = nextFrame;
      requestHeroFrame(nextFrame, "high");
      var frame = getReadyHeroFrame(nextFrame);
      if (frame) drawHeroFrame(frame.image);
      else {
        var fallbackFrame = closestLoadedHeroFrame(nextFrame);
        if (fallbackFrame) drawHeroFrame(fallbackFrame.image);
      }
      [-3, -2, -1, 1, 2, 3, direction * 6, direction * 10, direction * 16].forEach(function (offset) {
        requestHeroFrame(nextFrame + offset);
      });
    }
    updateHeroProgress(progress);
  }

  function requestHeroRender() {
    if (!heroIsVisible || heroAnimationFrame) return;
    heroAnimationFrame = window.requestAnimationFrame(function () {
      heroAnimationFrame = 0;
      renderHero();
    });
  }

  function startHeroAnimation() {
    if (heroIsVisible) return;
    heroIsVisible = true;
    warmHeroFrames();
    renderHero();
  }

  function stopHeroAnimation() {
    heroIsVisible = false;
    if (heroAnimationFrame) window.cancelAnimationFrame(heroAnimationFrame);
    heroAnimationFrame = 0;
  }

  resizeHeroCanvas();
  if (reduceMotion) {
    heroFrameIndex = 0;
    var reducedFrame = loadHeroFrame(0, "high");
    if (reducedFrame.complete && reducedFrame.naturalWidth) drawHeroFrame(reducedFrame);
    setHeroCopy(0);
    if (heroIndicator) heroIndicator.style.opacity = "1";
  } else if (heroSection && "IntersectionObserver" in window) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) startHeroAnimation();
        else stopHeroAnimation();
      });
    }, { rootMargin: "100% 0px 100% 0px", threshold: 0 });
    heroObserver.observe(heroSection);
  } else {
    startHeroAnimation();
  }
  window.addEventListener("scroll", requestHeroRender, { passive: true });
  window.addEventListener("resize", function () {
    resizeHeroCanvas();
    requestHeroRender();
  });

  var revealElements = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach(function (element) { element.classList.add("is-visible"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    revealElements.forEach(function (element) { revealObserver.observe(element); });
  }

  var featureSteps = Array.prototype.slice.call(document.querySelectorAll("[data-feature-step]"));
  var featureVideos = Array.prototype.slice.call(document.querySelectorAll("[data-feature-video]"));
  var featureStatus = document.querySelector("[data-feature-status]");
  var featureLabels = ["ورودی و پذیرش", "کنترل اسناد و ریسک", "گردش‌کارهای ترخیص", "تحلیل زمان و هزینه"];
  var persianDigits = "۰۱۲۳۴۵۶۷۸۹";

  function toPersianDigits(value) {
    return String(value).replace(/\d/g, function (digit) { return persianDigits[digit]; });
  }

  function playFeatureVideo(video) {
    var play = video.play();
    if (play && typeof play.catch === "function") play.catch(function () {});
  }

  function prepareFeatureVideo(video) {
    if (!video) return;
    video.preload = "auto";
    if (video.readyState < 3) {
      video.load();
      video.addEventListener("canplay", function () {
        if (video.classList.contains("is-active")) playFeatureVideo(video);
      }, { once: true });
    }
  }

  function setFeature(index) {
    featureSteps.forEach(function (step, stepIndex) {
      step.classList.toggle("is-active", stepIndex === index);
    });
    featureVideos.forEach(function (video, videoIndex) {
      video.classList.toggle("is-active", videoIndex === index);
      if (videoIndex === index) {
        prepareFeatureVideo(video);
        if (video.readyState >= 3) playFeatureVideo(video);
      } else {
        video.pause();
      }
    });
    if (featureVideos[index + 1]) {
      window.setTimeout(function () { prepareFeatureVideo(featureVideos[index + 1]); }, 180);
    }
    var featureIndex = document.querySelector(".feature-index");
    if (featureIndex) featureIndex.textContent = toPersianDigits(String(index + 1).padStart(2, "0")) + " / ۰۴";
    if (featureStatus) featureStatus.textContent = featureLabels[index];
  }

  if (!reduceMotion && "IntersectionObserver" in window) {
    var featureObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setFeature(Number(entry.target.getAttribute("data-feature-step")));
      });
    }, { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
    featureSteps.forEach(function (step) { featureObserver.observe(step); });
  } else {
    setFeature(0);
  }

  var platformTabs = Array.prototype.slice.call(document.querySelectorAll("[data-platform-tab]"));
  var platformCards = Array.prototype.slice.call(document.querySelectorAll("[data-platform-card]"));
  var platformTrack = document.querySelector("[data-platform-track]");
  var platformPrev = document.querySelector("[data-platform-prev]");
  var platformNext = document.querySelector("[data-platform-next]");
  var platformIndex = 0;

  function setPlatform(index) {
    platformIndex = Math.max(0, Math.min(platformCards.length - 1, index));
    platformTabs.forEach(function (tab, tabIndex) {
      var active = tabIndex === platformIndex;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    platformCards.forEach(function (card, cardIndex) {
      card.classList.toggle("is-active", cardIndex === platformIndex);
    });
    if (platformTrack && window.innerWidth > 800) {
      var distance = platformIndex * (platformTrack.parentElement.clientWidth * .39);
      var direction = document.documentElement.dir === "rtl" ? 1 : -1;
      platformTrack.style.transform = "translateX(" + (direction * distance) + "px)";
    } else if (platformCards[platformIndex]) {
      platformCards[platformIndex].scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "start" });
    }
    if (platformPrev) platformPrev.disabled = platformIndex === 0;
    if (platformNext) platformNext.disabled = platformIndex === platformCards.length - 1;
  }
  platformTabs.forEach(function (tab) {
    tab.addEventListener("click", function () { setPlatform(Number(tab.getAttribute("data-platform-tab"))); });
  });
  if (platformPrev) platformPrev.addEventListener("click", function () { setPlatform(platformIndex - 1); });
  if (platformNext) platformNext.addEventListener("click", function () { setPlatform(platformIndex + 1); });
  window.addEventListener("resize", function () { setPlatform(platformIndex); });

  var base = { total: 641626, labor: 255528, spotter: 193248, detention: 192850, percent: 23 };
  var roiIds = ["gates", "shifts", "days", "spotters", "checkins", "wage", "demurrage"];
  function value(id, fallback) {
    var input = document.getElementById("roi-" + id);
    var parsed = Number(input && input.value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  var numberFormatter = new Intl.NumberFormat("fa-IR");
  function formatNumber(number) { return numberFormatter.format(Math.round(number)); }
  function money(number) { return formatNumber(number) + " تومان"; }
  function updateRoi() {
    var gates = Math.max(1, value("gates", 2));
    var shifts = Math.max(1, value("shifts", 3));
    var days = Math.max(1, value("days", 6));
    var spotters = Math.max(0, value("spotters", 3));
    var checkins = Math.max(1, value("checkins", 45));
    var wage = Math.max(1, value("wage", 28));
    var demurrage = Math.max(1, value("demurrage", 4));
    var labor = base.labor * (gates / 2) * (shifts / 3) * (days / 6) * (wage / 28);
    var spotter = base.spotter * Math.max(.12, (spotters / 3) * (shifts / 3) * (days / 6));
    var detention = base.detention * (checkins / 45) * (days / 6) * (demurrage / 4);
    var total = labor + spotter + detention;
    var percent = Math.max(8, Math.min(46, Math.round(base.percent * Math.sqrt(total / base.total))));
    var totalElement = document.getElementById("roi-total");
    var percentElement = document.getElementById("roi-percent");
    var laborElement = document.getElementById("roi-labor");
    var spotterElement = document.getElementById("roi-spotter");
    var detentionElement = document.getElementById("roi-detention");
    if (totalElement) totalElement.textContent = formatNumber(total);
    if (percentElement) percentElement.textContent = formatNumber(percent) + "٪";
    if (laborElement) laborElement.textContent = money(labor);
    if (spotterElement) spotterElement.textContent = money(spotter);
    if (detentionElement) detentionElement.textContent = money(detention);
  }
  roiIds.forEach(function (id) {
    var input = document.getElementById("roi-" + id);
    if (input) input.addEventListener("input", updateRoi);
  });
  updateRoi();

  function showMessage(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("is-success", "is-error");
    if (type) element.classList.add(type);
  }
  var roiEmailForm = document.getElementById("roi-email-form");
  if (roiEmailForm) {
    roiEmailForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var email = document.getElementById("roi-email");
      var message = document.getElementById("roi-message");
      if (!email || !email.checkValidity()) {
        showMessage(message, "یک ایمیل کاری معتبر وارد کنید.", "is-error");
        if (email) email.focus();
        return;
      }
      showMessage(message, "این نسخه‌ی نمایشی محلی است و اطلاعات فرم را ارسال نمی‌کند.", "is-success");
      roiEmailForm.reset();
    });
  }

  var contactForm = document.getElementById("contact-form");
  if (contactForm) {
    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var message = document.getElementById("contact-message");
      if (!contactForm.checkValidity()) {
        showMessage(message, "برای ادامه، فیلدهای الزامی را کامل کنید.", "is-error");
        contactForm.querySelector(":invalid").focus();
        return;
      }
      showMessage(message, "این نسخه‌ی نمایشی محلی است و اطلاعات فرم را ارسال نمی‌کند.", "is-success");
      contactForm.reset();
    });
  }

  document.querySelectorAll(".faq-question").forEach(function (question) {
    question.addEventListener("click", function () {
      var row = question.closest(".faq-row");
      var answer = row.querySelector(".faq-answer");
      var open = row.classList.toggle("is-open");
      question.setAttribute("aria-expanded", String(open));
      answer.hidden = !open;
    });
  });

  document.querySelectorAll("[data-faq-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var category = tab.getAttribute("data-faq-tab");
      document.querySelectorAll("[data-faq-tab]").forEach(function (item) {
        var active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".faq-row").forEach(function (row) {
        var categories = row.getAttribute("data-faq-category") || "";
        row.hidden = category !== "all" && categories.indexOf(category) === -1;
      });
    });
  });
})();
