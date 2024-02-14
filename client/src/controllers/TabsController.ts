import { Controller } from '@hotwired/stimulus';
import { debounce } from '../utils/debounce';

/**
 * Returns a promise that will resolve after either the animation, translation
 * or the max delay of time is reached.
 *
 * If maxDelay is provided as zero or a falsey value, the promise resolve immediately.
 */
const afterTransition = (element: HTMLElement, { maxDelay = 300 } = {}) => {
  /**
   * Allow the passing of an initial value to the resolved promise.
   * If nothings is passed, the event will be passed to the promise.
   */
  let initValue: any;
  const promise = new Promise<AnimationEvent | TransitionEvent | undefined>(
    (resolve) => {
      if (!maxDelay) {
        resolve(initValue);
        return;
      }
      let timer: number | undefined;
      const finish = (event: AnimationEvent | TransitionEvent | undefined) => {
        if (event && event.target !== element) return;
        window.clearTimeout(timer);
        element.removeEventListener('transitionend', finish);
        element.removeEventListener('animationend', finish);
        resolve(initValue || event);
      };
      element.addEventListener('animationend', finish);
      element.addEventListener('transitionend', finish);
      timer = window.setTimeout(finish, maxDelay);
    },
  );
  return (init: any) => {
    initValue = typeof init === 'function' ? init() : init;
    return promise;
  };
};

interface IndexedEventTarget extends EventTarget {
  index: number;
}

interface TabLink extends HTMLAnchorElement {
  index: number;
}

/**
 * Adds the ability for the controlled elements to behave as selectable tabs.
 *
 * All tabs and tab content must be nested in an element within the scope of the controller.
 * All tab buttons need the role="tab" attr and an href with the tab content ID with the target 'label'.
 * Tab contents need to have the role="tabpanel" attribute and and ID attribute that matches the href of the tab link with the target 'panel'.
 * Tab buttons should also be wrapped in an element with the role="tablist" attribute.
 * Use the target 'trigger' on an Anchor link and set the href to the #ID of the tab you would like to trigger.
 *
 * @example
 * ```html
 *      <div data-controller="w-tabs" data-action="popstate@window->w-tabs#loadHistory" data-w-tabs-selected-class="animate-in">
 *         <div role="tablist" data-action="click->w-tabs#handleTabChange:prevent keydown.right->w-tabs#selectNext keydown.left->w-tabs#selectPrevious keydown.home->w-tabs#selectFirst keydown.end->w-tabs#selectLast">
 *           <a id="tab-label-tab-1" href="#tab-tab-1" role="tab" data-w-tabs-target="label">
 *             Tab 1
 *           </a>
 *           <a id="tab-label-tab-2" href="#tab-tab-2" role="tab" data-w-tabs-target="label">
 *             Tab 2
 *           </a>
 *          </div>
 *          <div class="tab-content tab-content--comments-enabled">
 *           <section id="tab-tab-1" role="tabpanel" aria-labelledby="tab-label-tab-1" data-w-tabs-target="panel">
 *             Tab 1 content
 *           </section>
 *           <section id="tab-tab-2" role="tabpanel" aria-labelledby="tab-label-tab-2" data-w-tabs-target="panel">
 *             Tab 2 content
 *           </section>
 *          </div>
 *      </div>
 * ```
 */

export class TabsController extends Controller<HTMLDivElement> {
  static targets = ['label', 'panel', 'trigger'];

  static classes = ['selected'];

  static values = {
    transition: { default: 150, type: Number },
    selected: { default: '', type: String },
    syncURLHash: { default: false, type: Boolean },
    animate: { default: true, type: Boolean },
  };

  /** ID of the currently selected tab. */
  declare selectedValue: string;
  /** If true, animation will run when a new tab is selected. */
  declare readonly animateValue: boolean;
  /** Tab elements, with role='tab', allowing switching between tabs. */
  declare readonly labelTargets: HTMLAnchorElement[];
  /** Tab content panels, with role='tabpanel', showing the content for each tab. */
  declare readonly panelTargets: HTMLElement[];
  /** Other elements within the controller's scope that may trigger a specific tab. */
  declare readonly triggerTargets: HTMLAnchorElement[];
  /** Classes to set on the tab panel content when selected. */
  declare readonly selectedClasses: string[];
  /** If true, the selected tab will sync with the URL hash. */
  declare readonly syncURLHashValue: boolean;
  /** The time in milliseconds for the tab content to transition in and out. */
  declare readonly transitionValue: number;

  connect() {
    this.validate();

    debounce(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, this.transitionValue * 2);

    this.setAriaControls(this.labelTargets);
    this.setTabLabelIndex();

    const activeTab = this.labelTargets.find(
      (button) =>
        button.getAttribute('aria-selected') === 'true' ||
        button.getAttribute('aria-controls') === this.selectedValue,
    );

    if (this.selectedClasses.length && activeTab) {
      activeTab.setAttribute('aria-selected', 'true');
      activeTab.removeAttribute('tabindex');
    }

    this.panelTargets.forEach((tab) => {
      // eslint-disable-next-line no-param-reassign
      tab.hidden = true;
    });

    if (window.location.hash && !this.syncURLHashValue) {
      this.setTabByURLHash();
    } else if (activeTab) {
      this.selectedValue = activeTab.getAttribute('aria-controls') as string;
    } else {
      this.selectFirstTab();
    }

    this.setAriaControls(this.triggerTargets);
  }

  selectedValueChanged(currentValue: string, previousValue: string) {
    if (previousValue) {
      this.hideTabContent(previousValue);
    }

    const tab = this.getTabLabelByHref(currentValue);
    if (tab) {
      tab.setAttribute('aria-selected', 'true');
      tab.removeAttribute('tabindex');
    }

    const tabContent = this.getTabPanelByHref(currentValue);

    if (tabContent) {
      if (this.animateValue) {
        this.animateIn(tabContent);
      } else {
        tabContent.hidden = false;
      }

      this.dispatch('switch', {
        detail: { tab: tab?.getAttribute('href')?.replace('#', '') },
        target: tab,
      });

      this.dispatch('selected', {
        cancelable: false,
        detail: { selected: currentValue },
      });

      if (!this.syncURLHashValue) {
        this.setURLHash(currentValue);
      }
    }
  }

  handleTriggerLinks(event: MouseEvent) {
    const href = (event.target as HTMLAnchorElement).getAttribute(
      'href',
    ) as string;
    const tab = this.getTabLabelByHref(href);
    if (tab) {
      this.selectedValue = href.replace('#', '');
      tab.focus();
    }
  }

  handleTabChange(event: MouseEvent) {
    const tabId = (event.target as HTMLElement).getAttribute(
      'aria-controls',
    ) as string;
    this.selectedValue = tabId;
  }

  getTabLabelByHref(tabId: string): HTMLElement | undefined {
    return this.labelTargets.find(
      (tab) => tab.getAttribute('aria-controls') === tabId,
    );
  }

  getTabPanelByHref(tabId: string): HTMLElement | undefined {
    return this.panelTargets.find((tab) => tab.getAttribute('id') === tabId);
  }

  setAriaControls(tabLinks: HTMLAnchorElement[]) {
    tabLinks.forEach((tabLink) => {
      const href = tabLink.getAttribute('href') as string;
      tabLink.setAttribute('aria-controls', href.replace('#', ''));
    });
  }

  setTabLabelIndex() {
    (this.labelTargets as TabLink[]).forEach((label, index) => {
      // eslint-disable-next-line no-param-reassign
      label.index = index;
    });
  }

  setURLHash(tabId: string) {
    if (!window.history.state || window.history.state.tabContent !== tabId) {
      // Add a new history item to the stack
      window.history.pushState({ tabContent: tabId }, '', `#${tabId}`);
    }
  }

  setTabByURLHash() {
    if (window.location.hash) {
      const cleanedHash = window.location.hash
        .replace(/[^\w\-#]/g, '')
        .replace('#', '');
      if (cleanedHash) {
        this.selectedValue = cleanedHash;
      } else {
        // The hash doesn't match a tab on the page then select first tab
        this.selectFirstTab();
      }
    }
  }

  selectFirstTab() {
    const href = this.labelTargets[0].getAttribute('aria-controls') as string;
    this.selectedValue = href;
  }

  animateIn(tabContent: HTMLElement) {
    const selectedClasses = this.selectedClasses;
    afterTransition(
      tabContent,
      // If there are no classes to add, we can skip the delay before hiding.
      selectedClasses.length
        ? { maxDelay: this.transitionValue }
        : { maxDelay: 0 },
    )(tabContent.classList.add(...selectedClasses)).then(() => {
      // eslint-disable-next-line no-param-reassign
      tabContent.hidden = false;
    });
  }

  animateOut(tabContent: HTMLElement) {
    const selectedClasses = this.selectedClasses;
    afterTransition(
      tabContent,
      // If there are no classes to add, we can skip the delay before hiding.
      selectedClasses.length
        ? { maxDelay: this.transitionValue }
        : { maxDelay: 0 },
    )(tabContent.classList.remove(...selectedClasses)).then(() => {
      // eslint-disable-next-line no-param-reassign
      tabContent.hidden = true;
    });
  }

  hideTabContent(tabId: string) {
    if (tabId === this.selectedValue || !this.selectedValue) {
      return;
    }

    const tabContent = this.getTabPanelByHref(tabId);
    if (!tabContent) {
      return;
    }
    if (this.animateValue) {
      this.animateOut(tabContent);
    } else {
      tabContent.hidden = true;
    }

    const tab = this.getTabLabelByHref(tabId);
    if (!tab) {
      return;
    }
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '-1');
  }

  selectNext(event: Event) {
    const tabIndex = (event.target as IndexedEventTarget).index;
    const tab = this.labelTargets[tabIndex + 1];
    if (!tab) {
      return;
    }
    this.selectedValue = tab.getAttribute('aria-controls') as string;
    tab.focus();
  }

  selectPrevious(event: Event) {
    const tabIndex = (event.target as IndexedEventTarget).index;
    const tab = this.labelTargets[tabIndex + -1];
    if (!tab) {
      return;
    }
    this.selectedValue = tab.getAttribute('aria-controls') as string;
    tab.focus();
  }

  selectFirst() {
    const tab = this.labelTargets[0];
    this.selectedValue = tab.getAttribute('aria-controls') as string;
    tab.focus();
  }

  selectLast() {
    const tab = this.labelTargets[this.labelTargets.length - 1];
    this.selectedValue = tab.getAttribute('aria-controls') as string;
    tab.focus();
  }

  loadHistory(event: PopStateEvent) {
    if (event.state && event.state.tabContent) {
      const tab = this.getTabLabelByHref(event.state.tabContent);
      if (tab) {
        this.selectedValue = event.state.tabContent;
        tab.focus();
      }
    }
  }

  validate() {
    this.labelTargets.forEach((label, idx) => {
      const panel = this.panelTargets[idx];

      if (label.getAttribute('role') !== 'tab') {
        // eslint-disable-next-line no-console
        console.warn(
          label,
          "this element does not have role='tab' aria attribute",
        );
      }

      if (panel.getAttribute('role') !== 'tabpanel') {
        // eslint-disable-next-line no-console
        console.warn(
          panel,
          "this element does not have role='tabpanel' aria attribute",
        );
      }

      if (panel.getAttribute('aria-labelledby') !== label.id) {
        // eslint-disable-next-line no-console
        console.warn(panel, 'this element does not have aria-labelledby');
      }
    });

    if (
      this.labelTargets.every(
        (target) =>
          (target.parentElement as HTMLElement).getAttribute('role') !==
          'tablist',
      )
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        this.labelTargets,
        "One or more tab (label) targets are not direct descendants of an element with role='tablist'.",
      );
    }
  }
}
