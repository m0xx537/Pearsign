//
//  TabEnum.swift
//  feather
//
//  Created by samara on 22.03.2025.
//

import SwiftUI
import NimbleViews

enum TabEnum: String, CaseIterable, Hashable {
	case home
	case sources
	case library
	case account
	case settings
	case certificates
	
	var title: String {
		switch self {
		case .home:         return "Home"
		case .sources:     	return .localized("Sources")
		case .library: 		return .localized("Library")
		case .account:      return "Account"
		case .settings: 	return .localized("Settings")
		case .certificates:	return .localized("Certificates")
		}
	}
	
	var icon: String {
		switch self {
		case .home:         return "house.fill"
		case .sources: 		return "globe.desk"
		case .library: 		return "square.grid.2x2"
		case .account:      return "person.crop.circle"
		case .settings: 	return "gearshape.2"
		case .certificates: return "person.text.rectangle"
		}
	}
	
	@ViewBuilder
	static func view(for tab: TabEnum) -> some View {
		switch tab {
		case .home: PearsignHomeView()
		case .sources: SourcesView()
		case .library: LibraryView()
		case .account: PearsignAccountView()
		case .settings: SettingsView()
		case .certificates: NBNavigationView(.localized("Certificates")) { CertificatesView() }
		}
	}
	
	static var defaultTabs: [TabEnum] {
		return [
			.home,
			.sources,
			.library,
			.account,
			.settings
		]
	}
	
	static var customizableTabs: [TabEnum] {
		return [
			.certificates
		]
	}
}
