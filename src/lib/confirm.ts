// "Are you sure?" and "here is what happened", in one place.
//
// React Native's Alert exists on phones and does nothing at all on the web
// build, so anything guarded by a bare Alert.alert would silently do nothing
// in a browser. These two wrap the platform's own dialogs instead.

import { Alert, Platform } from "react-native";

export function confirmAction({
  title,
  message,
  confirm = "Yes",
  cancel = "No",
  destructive = false,
}: {
  title: string;
  message: string;
  confirm?: string;
  cancel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(`${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: confirm, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]);
  });
}

export function tellMember(title: string, message: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: "OK", onPress: () => resolve() }]);
  });
}
