interface Window {
  SiteVisitorCount?: { mount(element: HTMLElement, site: string, isDisabled?: () => boolean): Promise<void> };
}
