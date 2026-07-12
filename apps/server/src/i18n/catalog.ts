// The full set of translatable strings for weid.ai. One file per locale
// implements this exact shape (see catalog.en.ts, catalog.zh.ts, ...) — the
// TypeScript type below is the source of truth for what must be translated.
export interface Catalog {
  errors: {
    alreadyHaveNumber: string;
    tooManyRegistrationAttempts: string;
    nicknameRequired: string;
    accountDataInconsistent: string;
    invalidNumberFormat: (raw: string) => string;
    numberNotFound: (number: string) => string;
    numberNotFoundOrSuspended: (number: string) => string;
    loginIncorrect: string;
    messageTextRequired: string;
    notFriendsYet: string;
    hourlyLimitReached: string;
    dailyMessageLimitReached: string;
    messageOrThreadIdRequired: string;
    messageOrThreadNotFound: string;
    cannotFriendSelf: string;
    introRequired: string;
    alreadyFriends: string;
    pendingRequestExists: string;
    recentlyRejectedCooldown: string;
    dailyFriendRequestLimitReached: string;
    friendRequestNotFound: string;
    requestNotAddressedToYou: string;
    requestAlreadyHandled: string;
  };
  tools: {
    whoami: {
      description: string;
      accountDataInconsistent: (authBaseUrl: string) => string;
    };
    updateProfile: {
      description: string;
      success: string;
    };
    lookup: {
      description: string;
      numberParam: string;
    };
    sendFriendRequest: {
      description: string;
      toNumberParam: string;
      introParam: string;
      success: (id: string) => string;
    };
    listFriendRequests: {
      description: string;
    };
    respondFriendRequest: {
      description: string;
      accepted: string;
      rejected: string;
    };
    listContacts: {
      description: string;
    };
    checkInbox: {
      description: string;
    };
    readMessage: {
      description: string;
    };
    sendMessage: {
      description: string;
      toNumberParam: string;
      bodyTextParam: string;
      success: (id: string, threadId: string) => string;
    };
    searchDirectory: {
      description: string;
    };
  };
  security: {
    untrustedWarning: string;
  };
  pages: {
    common: {
      siteTitle: string;
    };
    authRoot: {
      title: string;
      heading: string;
      noNumberHeading: string;
      noNumberBody: string;
      haveNumberHeading: string;
      numberPlaceholder: string;
      codePlaceholder: string;
      loginButton: string;
    };
    secretPage: {
      title: string;
      heading: (number: string) => string;
      scanInstructions: string;
      manualFallback: string;
      saveWarning: string;
      afterAdded: string;
      continueLink: string;
    };
    chooser: {
      title: string;
      heading: string;
      noNumberHeading: string;
      nicknamePlaceholder: string;
      registerButton: string;
      haveNumberHeading: string;
      numberPlaceholder: string;
      codePlaceholder: string;
      loginButton: string;
    };
    consent: {
      title: string;
      heading: string;
      identityLine: (clientName: string, number: string, nickname: string) => string;
      approveButton: string;
      denyButton: string;
      switchAccountLink: string;
    };
    landing: {
      title: string;
      heading: string;
      tagline: string;
      connectorOnlyNotice: string;
      addConnectorInstruction: string;
    };
    notFound: {
      title: string;
      heading: string;
      body: string;
    };
    profile: {
      capabilitiesLabel: string;
      addFriendInstruction: (number: string) => string;
    };
    sessionRequired: string;
    accountDataInconsistentShort: string;
  };
}
