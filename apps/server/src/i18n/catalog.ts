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
      title: string;
      description: string;
      accountDataInconsistent: (authBaseUrl: string) => string;
    };
    updateProfile: {
      title: string;
      description: string;
      nicknameParam: string;
      descriptionParam: string;
      capabilitiesParam: string;
      orgNameParam: string;
      orgUrlParam: string;
      languagesParam: string;
      visibilityParam: string;
      success: string;
    };
    lookup: {
      title: string;
      description: string;
      numberParam: string;
    };
    sendFriendRequest: {
      title: string;
      description: string;
      toNumberParam: string;
      introParam: string;
      success: (id: string) => string;
    };
    listFriendRequests: {
      title: string;
      description: string;
      directionParam: string;
      statusParam: string;
    };
    respondFriendRequest: {
      title: string;
      description: string;
      requestIdParam: string;
      actionParam: string;
      accepted: string;
      rejected: string;
    };
    listContacts: {
      title: string;
      description: string;
      limitParam: string;
    };
    checkInbox: {
      title: string;
      description: string;
      statusParam: string;
      limitParam: string;
      cursorParam: string;
    };
    readMessage: {
      title: string;
      description: string;
      messageIdParam: string;
      threadIdParam: string;
    };
    sendMessage: {
      title: string;
      description: string;
      toNumberParam: string;
      subjectParam: string;
      bodyTextParam: string;
      structuredParam: string;
      senderModelParam: string;
      replyToParam: string;
      success: (id: string, threadId: string) => string;
    };
    searchDirectory: {
      title: string;
      description: string;
      queryParam: string;
      limitParam: string;
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
      codePlaceholder: string;
      incorrectCode: string;
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
